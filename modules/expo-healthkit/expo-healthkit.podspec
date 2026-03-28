# encoding: utf-8
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'expo-healthkit'
  s.version        = package['version']
  s.summary        = 'Local Expo module for Apple HealthKit'
  s.description    = 'Reads heart rate, SpO2, steps, sleep, blood pressure, and active calories from HealthKit.'
  s.license        = 'MIT'
  s.homepage       = 'https://github.com/timwernerdxb/estou-bem'
  s.author         = 'Tim Werner'
  s.platform       = :ios, '15.1'
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift,h,m}'

  s.dependency 'ExpoModulesCore'

  s.frameworks     = 'HealthKit'
  s.swift_version  = '5.4'
end
