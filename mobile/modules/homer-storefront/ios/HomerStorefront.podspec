Pod::Spec.new do |s|
  s.name = 'HomerStorefront'
  s.version = '1.0.0'
  s.summary = 'Read the current App Store storefront for Homer.'
  s.homepage = 'https://github.com/wolf3c/homer'
  s.license = 'Apache-2.0'
  s.author = 'Homer'
  s.source = { :git => 'https://github.com/wolf3c/homer.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
