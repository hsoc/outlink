import { Alert } from 'react-native';
export const confirmationDialogAdapter = {
  confirm(title: string, message: string, cancel: string, confirm: string): Promise<boolean> {
    return new Promise(resolve => Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirm, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }));
  },
};
