import Foundation
import SQLite3

/** Exercise the shipping Swift/JavaScriptCore bridge with ephemeral test storage. */
@main
struct RuntimeHarness {
  static func main() throws {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1])
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("fixture.json"))) as! [String: Any]
    var keys = fixture["keys"] as! [String: String]
    let semaphore = DispatchSemaphore(value: 0)
    let runtime = NotificationRuntime(
      databaseLocation: { (directory.appendingPathComponent("outlink.db").path, fixture["schemaVersion"] as! NSNumber) },
      scriptLoader: { try String(contentsOf: directory.appendingPathComponent("\($0).js"), encoding: .utf8) },
      credentialAccess: { method, args in
        let key = args[0] as! String
        if method == "keyGet" { return keys[key] as Any? ?? NSNull() }
        if method == "keySet" { keys[key] = args[1] as? String }
        if method == "keyDelete" { keys.removeValue(forKey: key) }
        return NSNull()
      }
    )
    runtime.start(payload: fixture["payload"] as! [String: Any]) { result in
      let data = try! JSONSerialization.data(withJSONObject: result ?? ["status": "native-error"], options: [.sortedKeys])
      print(String(decoding: data, as: UTF8.self))
      semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 20) == .success else { fatalError("Native runtime deadline exceeded") }
    withExtendedLifetime(runtime) {}
  }
}
