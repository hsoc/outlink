Pod::Spec.new do |s|
  s.name           = 'ExpoLocalNotifications'
  s.version        = '0.1.0'
  s.summary        = 'Notifications and badges for Outlink'
  s.description    = 'System local notifications, APNs registration, and badges.'
  s.author         = 'outlink'
  s.homepage       = 'https://github.com/hsoc/outlink'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { :git => '' }
  s.source_files   = '**/*.swift'
  s.libraries = 'sqlite3'
  s.dependency 'ExpoModulesCore'
end
