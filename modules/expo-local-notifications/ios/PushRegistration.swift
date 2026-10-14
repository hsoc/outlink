import ExpoModulesCore
import UIKit

/** All registration state stays on the main thread with UIApplication callbacks. */
@MainActor
final class PushRegistration {
  static let shared = PushRegistration()
  static let tokenChanged = Notification.Name("OutlinkPushTokenChanged")
  private var token: String?
  private var pending: [Promise] = []
  private var timeout: DispatchWorkItem?
  private var enabled = false

  func register(_ promise: Promise) {
    enabled = true
    pending.append(promise)
    if pending.count == 1 {
      let deadline = DispatchWorkItem { [weak self] in
        self?.fail(NSError(domain: "OutlinkPush", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "APNs registration timed out",
        ]))
      }
      timeout = deadline
      DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: deadline)
      UIApplication.shared.registerForRemoteNotifications()
    }
  }

  func receive(_ data: Data) {
    guard enabled else { return }
    let next = data.map { String(format: "%02x", $0) }.joined()
    let changed = token != next
    token = next
    timeout?.cancel()
    timeout = nil
    let waiting = pending
    pending.removeAll()
    waiting.forEach { $0.resolve(next) }
    if changed { NotificationCenter.default.post(name: Self.tokenChanged, object: nil) }
  }

  func fail(_ error: Error) {
    timeout?.cancel()
    timeout = nil
    let waiting = pending
    pending.removeAll()
    waiting.forEach { $0.reject("ERR_APNS_REGISTRATION", error.localizedDescription) }
  }

  func unregister() {
    enabled = false
    token = nil
    fail(NSError(domain: "OutlinkPush", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "APNs registration cancelled",
    ]))
    UIApplication.shared.unregisterForRemoteNotifications()
  }
}
