import ExpoModulesCore
import ImageIO
import UIKit
import UniformTypeIdentifiers
import UserNotifications

public final class ExpoLocalNotificationsModule: Module {
  private let notifications = LocalNotificationService()
  private var pushObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ExpoLocalNotifications")
    Constants([
      "sharedKeychainGroup": SharedNotificationStorage.keychainGroup as Any,
      "notificationProcessorVersion": Bundle.main.builtInPlugInsURL.map {
        FileManager.default.fileExists(atPath: $0.appendingPathComponent("OutlinkNotificationService.appex").path) ? 1 : 0
      } ?? 0,
    ])
    AsyncFunction("sharedDatabaseDirectoryAsync") { (legacyDirectory: String) throws -> String in
      try SharedNotificationStorage.databaseDirectory(legacyDirectory: legacyDirectory)
    }
    Events("onPushTokenChanged", "onSharedDatabaseChanged")
    OnCreate {
      CFNotificationCenterAddObserver(CFNotificationCenterGetDarwinNotifyCenter(),
        Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
          guard let observer else { return }
          let module = Unmanaged<ExpoLocalNotificationsModule>.fromOpaque(observer).takeUnretainedValue()
          DispatchQueue.main.async { module.sendEvent("onSharedDatabaseChanged", [:]) }
        }, SharedNotificationContext.databaseChanged as CFString, nil, .deliverImmediately)
      self.pushObserver = NotificationCenter.default.addObserver(
        forName: Notification.Name("OutlinkPushTokenChanged"), object: nil, queue: .main
      ) { [weak self] _ in self?.sendEvent("onPushTokenChanged", [:]) }
    }
    OnDestroy {
      CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(),
        Unmanaged.passUnretained(self).toOpaque(), nil, nil)
      if let observer = self.pushObserver { NotificationCenter.default.removeObserver(observer) }
      self.pushObserver = nil
    }
    AsyncFunction("setActiveConversationAsync") { (account: String?, conversation: String?) in
      SharedNotificationContext.setActiveConversation(account: account, conversation: conversation)
    }
    AsyncFunction("registerPushAsync") { (promise: Promise) in
      Task { @MainActor in PushRegistration.shared.register(promise) }
    }
    AsyncFunction("unregisterPushAsync") { () async in
      await MainActor.run { PushRegistration.shared.unregister() }
    }

    AsyncFunction("hasPermissionAsync") { () async -> Bool in
      await self.notifications.hasPermission()
    }
    AsyncFunction("ensurePermissionAsync") { (_: String) async throws -> Bool in
      try await self.notifications.ensurePermission()
    }
    AsyncFunction("presentAsync") {
      (title: String, subtitle: String?, body: String?, avatarPath: String?, badgeCount: Int) async throws -> Bool in
      try await self.notifications.present(title, subtitle, body, avatarPath, badgeCount)
    }
    AsyncFunction("presentCommunicationAsync") {
      (title: String, subtitle: String?, body: String?, avatarPath: String?, badgeCount: Int, identity: String) async throws -> Bool in
      let communication = identity.data(using: .utf8).flatMap {
        try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
      }
      return try await self.notifications.present(title, subtitle, body, avatarPath, badgeCount, communication: communication)
    }
    AsyncFunction("dismissAllAsync") { () async in
      await self.notifications.dismissAll()
    }
    AsyncFunction("setBadgeCountAsync") { (count: Int) async throws -> Bool in
      try await self.notifications.setBadgeCount(count)
    }
  }
}

private actor LocalNotificationService {
  private let center = UNUserNotificationCenter.current()
  private var generation = 0

  func hasPermission() async -> Bool {
    switch await center.notificationSettings().authorizationStatus {
    case .authorized, .provisional, .ephemeral: return true
    default: return false
    }
  }

  func ensurePermission() async throws -> Bool {
    if await center.notificationSettings().authorizationStatus == .notDetermined {
      _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
    }
    return await hasPermission()
  }

  func present(_ title: String, _ subtitle: String?, _ body: String?, _ avatarPath: String?, _ badgeCount: Int, communication: [String: Any]? = nil) async throws -> Bool {
    let epoch = generation
    guard await hasPermission() else { return false }
    let content = UNMutableNotificationContent()
    content.title = title
    content.subtitle = subtitle ?? ""
    content.body = body ?? ""
    content.sound = .default
    content.badge = NSNumber(value: max(0, badgeCount))

    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    if communication == nil, let avatarPath, let attachment = avatarAttachment(avatarPath, directory: directory) {
      content.attachments = [attachment]
    }

    let presentation = if let communication {
      await CommunicationNotification.update(content, identity: communication,
        imageData: CommunicationNotification.localImage(avatarPath))
    } else {
      content as UNNotificationContent
    }
    let backgrounded = await MainActor.run { UIApplication.shared.applicationState == .background }
    guard generation == epoch, backgrounded else { return true }
    let identifier = UUID().uuidString
    try await center.add(UNNotificationRequest(identifier: identifier, content: presentation, trigger: nil))
    // add() may finish after an account switch or foreground cleanup.
    if generation != epoch {
      center.removePendingNotificationRequests(withIdentifiers: [identifier])
      center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }
    return true
  }

  func dismissAll() {
    generation += 1
    center.removeAllPendingNotificationRequests()
    center.removeAllDeliveredNotifications()
  }

  func setBadgeCount(_ count: Int) async throws -> Bool {
    guard await center.notificationSettings().badgeSetting == .enabled else { return false }
    try await center.setBadgeCount(max(0, count))
    return true
  }

  // Downsample off the main thread and create a private copy; never move the shared image cache.
  private func avatarAttachment(_ path: String, directory: URL) -> UNNotificationAttachment? {
    let sourceURL = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
    guard let sourceURL, sourceURL.isFileURL,
      let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 256,
        kCGImageSourceShouldCacheImmediately: true,
      ] as CFDictionary)
    else { return nil }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let target = directory.appendingPathComponent("avatar.png")
      guard let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else { return nil }
      CGImageDestinationAddImage(destination, thumbnail, nil)
      guard CGImageDestinationFinalize(destination) else { return nil }
      return try UNNotificationAttachment(identifier: "sender-avatar", url: target)
    } catch {
      return nil
    }
  }
}
