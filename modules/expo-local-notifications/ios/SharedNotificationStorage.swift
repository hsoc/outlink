import Foundation
import Security
import SQLite3

/** Shared storage is scoped to the installed development/production identity. */
enum SharedNotificationStorage {
  static var appGroup: String? { Bundle.main.object(forInfoDictionaryKey: "OutlinkAppGroup") as? String }
  static var keychainGroup: String? { Bundle.main.object(forInfoDictionaryKey: "OutlinkKeychainGroup") as? String }

  static func databaseDirectory(legacyDirectory: String) throws -> String {
    guard let group = appGroup,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { throw failure("Shared notification container unavailable") }
    let directory = container.appendingPathComponent("SQLite", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    let target = directory.appendingPathComponent("outlink.db")
    let legacy = URL(string: legacyDirectory)?.isFileURL == true
      ? URL(string: legacyDirectory)!.appendingPathComponent("outlink.db")
      : URL(fileURLWithPath: legacyDirectory).appendingPathComponent("outlink.db")
    let migrationMarker = directory.appendingPathComponent("migration-source.txt")
    if !FileManager.default.fileExists(atPath: target.path), FileManager.default.fileExists(atPath: legacy.path) {
      // SQLite backup includes committed WAL pages. Publish only a complete backup
      // before removing the original, including its WAL and SHM companions.
      let staged = directory.appendingPathComponent("migration-\(UUID().uuidString).db")
      defer { try? FileManager.default.removeItem(at: staged) }
      var source: OpaquePointer?
      var destination: OpaquePointer?
      defer { sqlite3_close(source); sqlite3_close(destination) }
      guard sqlite3_open_v2(legacy.path, &source, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
        sqlite3_open(staged.path, &destination) == SQLITE_OK,
        let backup = sqlite3_backup_init(destination, "main", source, "main")
      else { throw failure("Cannot open notification database migration") }
      sqlite3_busy_timeout(source, 5_000)
      let step = sqlite3_backup_step(backup, -1)
      let finish = sqlite3_backup_finish(backup)
      guard step == SQLITE_DONE && finish == SQLITE_OK else { throw failure("Notification database backup failed") }
      sqlite3_close(destination)
      destination = nil
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: staged.path)
      try legacy.path.write(to: migrationMarker, atomically: true, encoding: .utf8)
      try FileManager.default.moveItem(at: staged, to: target)
      sqlite3_close(source)
      source = nil
    }
    // A crash after publication resumes cleanup, without creating a second history.
    if FileManager.default.fileExists(atPath: target.path),
      (try? String(contentsOf: migrationMarker, encoding: .utf8)) == legacy.path {
      for path in [legacy.path, legacy.path + "-wal", legacy.path + "-shm"] {
        if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(atPath: path) }
      }
      try FileManager.default.removeItem(at: migrationMarker)
    }
    return directory.path
  }

  private static func failure(_ message: String) -> NSError {
    NSError(domain: "OutlinkSharedStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
