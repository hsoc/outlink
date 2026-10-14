import * as ImagePicker from 'expo-image-picker';
import AtSign from 'lucide-react-native/icons/at-sign';
import Check from 'lucide-react-native/icons/check';
import { Copy } from '@solar-icons/react-native/category/ui/Linear/Copy';
import { DirectionalChevron as ChevronRight } from '@/components/common/DirectionalChevron';
import { KeyMinimalistic as Fingerprint } from '@solar-icons/react-native/category/security/Linear/KeyMinimalistic';
import { QrCode } from '@solar-icons/react-native/category/security/Linear/QrCode';
import { Bolt } from '@solar-icons/react-native/category/ui/Linear/Bolt';
import { UserRounded as User } from '@solar-icons/react-native/category/users/Linear/UserRounded';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type TextInput,
  View,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppScreen } from '@/components/common/AppScreen';
import { backSafely } from '@/lib/navigation';
import { useClipboard } from '@/hooks/use-clipboard';
import { IS_ELECTRON, IS_IOS } from '@/lib/platform';
import { Avatar } from '@/components/common/Avatar';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { PhotoCaptureModal } from '@/components/common/PhotoCaptureModal';
import { ImageSourcePicker } from '@/components/profile/ImageSourcePicker';
import { NpubQrSheet } from '@/components/profile/NpubQrSheet';
import { useScrolled } from '@/hooks/use-scrolled';
import { useProfile } from '@/hooks/use-profile';
import { resolveName } from '@/lib/nostr/display-name';
import { pubkeyToNpub } from '@/lib/nostr/keys';
import { normalizeNip05Identifier } from '@/lib/nostr/nip05';
import { platform } from '@/platform';
import { buildSigner } from '@/services/account/account.service';
import { uploadPublicImage } from '@/services/files/blossom.service';
import { loadAccountMediaServers } from '@/services/files/media-server.service';
import { saveProfile, type ProfileMetadataInput } from '@/services/profile/profile.service';
import { loadAccountDmRelays } from '@/services/relay/relay-list.service';
import { mediaViewer } from '@/stores/media-viewer.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

type CopyField = 'npub' | 'nip05' | 'lightning';
type DraftPicture = {
  uri: string;
  mime: string;
  needsUpload: boolean;
};

/**
 * The user's own profile has two explicit modes. View mode presents public
 * identifiers as copyable rows; Edit switches the whole surface to one form and
 * Save publishes all changed fields together via {@link saveProfile}. The form
 * keeps a selected avatar local until Save, so leaving edit mode discards every
 * draft consistently. Other users use {@link PeerProfile}.
 */
export function ProfileView({ pubkey }: { pubkey: string }) {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const { copyText, copiedKey: copiedField, resetCopied } = useClipboard<CopyField>({ toastTarget: 'detail' });
  const c = useThemeColors();
  const profile = useProfile(pubkey);
  const titleClearance = useScreenHeaderClearance();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingSource, setPendingSource] = useState<'library' | 'camera' | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNip05, setDraftNip05] = useState('');
  const [nip05InputErrorVisible, setNip05InputErrorVisible] = useState(false);
  const [draftLightningAddress, setDraftLightningAddress] = useState('');
  const [draftPicture, setDraftPicture] = useState<DraftPicture | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const nip05InputRef = useRef<TextInput>(null);
  const lightningInputRef = useRef<TextInput>(null);

  const npub = pubkeyToNpub(pubkey);
  // Own profile — no petname for yourself, so resolve from the published name.
  const name = resolveName(profile) ?? '';
  const displayName = name || t('profile.unnamed');
  const nip05 = profile?.nip05 || '';
  const lightningAddress = profile?.lud16 || profile?.lud06 || '';
  const previewPicture = editing && draftPicture ? draftPicture.uri : profile?.picture;
  async function copyValue(field: CopyField, value: string) {
    if (!value) return;
    await copyText(value, field);
  }

  /** Merge changed fields over the existing kind-0 so unknown fields survive. */
  async function persist(metadata: ProfileMetadataInput) {
    const signer = await buildSigner(pubkey);
    const dmRelays = await loadAccountDmRelays(pubkey);
    await saveProfile({ signer, accountPubkey: pubkey, metadata, relays: dmRelays });
  }

  function stagePicture(asset: ImagePicker.ImagePickerAsset) {
    setDraftPicture({
      uri: asset.uri,
      mime: asset.mimeType ?? 'image/jpeg',
      needsUpload: true,
    });
  }

  async function pickFromLibrary() {
    // Preserve iOS photo editing access without requesting Android library access.
    if (IS_IOS) {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        await platform.confirmationDialog.notify({
          title: t('profile_edit.photo_permission'),
          okLabel: t('common.ok'),
        });
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    stagePicture(result.assets[0]);
  }

  async function pickFromCamera() {
    if (IS_ELECTRON) {
      setPhotoCaptureOpen(true);
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      await platform.confirmationDialog.notify({
        title: t('profile_edit.camera_permission'),
        okLabel: t('common.ok'),
      });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    stagePicture(result.assets[0]);
  }

  function beginEditing() {
    setDraftName(name);
    setDraftNip05(nip05);
    setNip05InputErrorVisible(false);
    setDraftLightningAddress(lightningAddress);
    setDraftPicture(null);
    resetCopied();
    // Ownership is remote state and may have changed since the previous edit session.
    setEditing(true);
  }

  function leaveEditing() {
    if (savingProfile) return;
    setEditing(false);
    setNip05InputErrorVisible(false);
    setDraftPicture(null);
    setPickerOpen(false);
    setPendingSource(null);
  }

  function handleBack() {
    if (editing) leaveEditing();
    else backSafely();
  }

  async function saveEdits() {
    if (!editing || savingProfile) return;

    const nextName = draftName.trim();
    const nextNip05 = draftNip05.trim();
    const nextLightningAddress = draftLightningAddress.trim();
    if (
      nextNip05 !== nip05 &&
      nextNip05.length > 0 &&
      normalizeNip05Identifier(nextNip05) === null
    ) {
      setNip05InputErrorVisible(true);
      nip05InputRef.current?.focus();
      return;
    }
    const textChanged =
      nextName !== name ||
      nextNip05 !== nip05 ||
      nextLightningAddress !== lightningAddress;

    if (!textChanged && !draftPicture) {
      setEditing(false);
      return;
    }

    setSavingProfile(true);
    try {
      let pictureUrl: string | undefined;
      if (draftPicture) {
        pictureUrl = draftPicture.uri;
        if (draftPicture.needsUpload) {
          try {
            const signer = await buildSigner(pubkey);
            const servers = await loadAccountMediaServers(pubkey);
            const uploaded = await uploadPublicImage({
              signer,
              fileUri: draftPicture.uri,
              mime: draftPicture.mime,
              servers,
            });
            pictureUrl = uploaded.url;
            setDraftPicture({ uri: uploaded.url, mime: '', needsUpload: false });
          } catch {
            await platform.confirmationDialog.notify({
              title: t('profile_edit.upload_failed'),
              okLabel: t('common.ok'),
            });
            return;
          }
        }
      }

      const metadata: ProfileMetadataInput = {
        name: nextName,
        nip05: nextNip05,
        lud16: nextLightningAddress,
        lud06: '',
      };
      if (pictureUrl !== undefined) metadata.picture = pictureUrl;

      await persist(metadata);
      setEditing(false);
      setDraftPicture(null);
    } catch {
      await platform.confirmationDialog.notify({
        title: t('profile_edit.save_failed'),
        okLabel: t('common.ok'),
      });
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <AppScreen edges={[]}>
      <AppFormScrollView
        {...scrollProps}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: titleClearance + 8, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* avatar; photo changes belong to the edit draft */}
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <Pressable
            onPress={() => (previewPicture ? mediaViewer.open(previewPicture) : undefined)}
            disabled={!previewPicture}
          >
            <Avatar pubkey={pubkey} picture={previewPicture} name={displayName} size={96} />
          </Pressable>
          {editing ? (
            <View>
              <AppButton
                label={t('profile.edit_photo')}
                variant="secondary"
                size="sm"
                fullWidth={false}
                disabled={savingProfile}
                onPress={() => setPickerOpen(true)}
              />
            </View>
          ) : null}
        </View>

        {/* sharing */}
        {!editing ? (
          <View style={{ marginTop: spacing.xl }}>
            <ListGroup>
              <ListRow
                icon={<QrCode size={22} color={c.text} />}
                title={t('profile.show_qr')}
                trailing={<ChevronRight size={18} color={c.textMuted} />}
                onPress={() => setQrOpen(true)}
              />
            </ListGroup>
          </View>
        ) : null}
        <View style={{ marginTop: spacing['2xl'], gap: spacing.md }}>
          {editing ? (
            <View style={{ gap: spacing.lg }}>
              <AppInput
                label={t('profile_edit.username')}
                value={draftName}
                onChangeText={setDraftName}
                placeholder={t('profile_edit.username_placeholder')}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!savingProfile}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => nip05InputRef.current?.focus()}
              />
              <View style={{ gap: spacing.xs }}>
                <AppInput
                  ref={nip05InputRef}
                  label={t('profile_edit.nip05')}
                  value={draftNip05}
                  onChangeText={(value) => {
                    setDraftNip05(value);
                    setNip05InputErrorVisible(false);
                  }}
                  placeholder={t('profile_edit.nip05_placeholder')}
                  error={
                    nip05InputErrorVisible
                      ? t('profile_edit.nip05_invalid')
                      : undefined
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!savingProfile}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => lightningInputRef.current?.focus()}
                />
              </View>
              <AppInput
                ref={lightningInputRef}
                label={t('profile_edit.lightning_address')}
                value={draftLightningAddress}
                onChangeText={setDraftLightningAddress}
                placeholder={t('profile_edit.lightning_address_placeholder')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!savingProfile}
                returnKeyType="done"
              />
            </View>
          ) : (
            <ListGroup>
              <ListRow
                icon={<User size={22} color={c.text} />}
                title={t('profile_edit.username')}
                value={displayName}
                valueTone="default"
                valuePlacement="below"
              />
              <ListRow
                icon={<Fingerprint size={22} color={c.text} />}
                title={t('profile.public_key')}
                value={npub}
                valueTone="default"
                valuePlacement="below"
                valueEllipsizeMode="middle"
                trailing={
                  copiedField === 'npub' ? (
                    <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                  ) : (
                    <Copy size={18} color={c.textMuted} />
                  )
                }
                onPress={() => void copyValue('npub', npub)}
              />
              <ListRow
                icon={<AtSign size={22} color={c.text} strokeWidth={iconStrokeWidth.default} />}
                title={t('profile.nip05')}
                value={nip05 || t('profile.not_set')}
                valueTone={nip05 ? 'default' : 'muted'}
                valuePlacement="below"
                valueEllipsizeMode="middle"
                trailing={
                  nip05 ? (
                    copiedField === 'nip05' ? (
                      <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                    ) : (
                      <Copy size={18} color={c.textMuted} />
                    )
                  ) : null
                }
                onPress={nip05 ? () => void copyValue('nip05', nip05) : undefined}
              />
              <ListRow
                icon={<Bolt size={22} color={c.text} />}
                title={t('profile.lightning_address')}
                value={lightningAddress || t('profile.not_set')}
                valueTone={lightningAddress ? 'default' : 'muted'}
                valuePlacement="below"
                valueEllipsizeMode="middle"
                trailing={
                  lightningAddress ? (
                    copiedField === 'lightning' ? (
                      <Check strokeWidth={iconStrokeWidth.default} size={18} color={c.success} />
                    ) : (
                      <Copy size={18} color={c.textMuted} />
                    )
                  ) : null
                }
                onPress={
                  lightningAddress
                    ? () => void copyValue('lightning', lightningAddress)
                    : undefined
                }
              />
            </ListGroup>
          )}
        </View>

      </AppFormScrollView>
      <ScreenHeader
        bordered={scrolled}
        onBack={handleBack}
        right={
          <AppButton
            label={editing ? t('profile_edit.save') : t('common.edit')}
            variant="text"
            corner="full"
            fullWidth={false}
            loading={savingProfile}
            onPress={editing ? () => void saveEdits() : beginEditing}
          />
        }
      />

      <ImageSourcePicker
        visible={pickerOpen}
        currentUrl={
          draftPicture && !draftPicture.needsUpload
            ? draftPicture.uri
            : (profile?.picture ?? '')
        }
        onClose={() => setPickerOpen(false)}
        onClosed={() => {
          const s = pendingSource;
          setPendingSource(null);
          if (!s) return;
          // Launch the native picker only after the sheet has fully closed —
          // presenting two modals during the transition freezes the screen.
          if (s === 'library') void pickFromLibrary();
          else void pickFromCamera();
        }}
        onPickLibrary={() => {
          setPendingSource('library');
          setPickerOpen(false);
        }}
        onPickCamera={() => {
          setPendingSource('camera');
          setPickerOpen(false);
        }}
        onSubmitUrl={(url) => {
          setPickerOpen(false);
          setDraftPicture({ uri: url, mime: '', needsUpload: false });
        }}
      />

      <NpubQrSheet
        toastTarget="detail"
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        npub={npub}
        name={name}
        nip05={nip05}
      />

      <PhotoCaptureModal
        visible={photoCaptureOpen}
        permissionDeniedMessage={t('profile_edit.camera_permission')}
        accessibilityLabel={t('common.take_photo')}
        onClose={() => setPhotoCaptureOpen(false)}
        onCaptured={stagePicture}
      />

    </AppScreen>
  );
}
