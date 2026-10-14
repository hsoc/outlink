Pod::Spec.new do |s|
  s.name           = 'ExpoFileDrop'
  s.version        = '0.1.0'
  s.summary        = 'Native file drop targets for Outlink'
  s.description    = 'Receives files dragged into Outlink on iOS and Android.'
  s.author         = 'outlink'
  s.homepage       = 'https://github.com/hsoc/outlink'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.0'
  s.source         = { git: '' }
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
