#!/usr/bin/env ruby

# Displays clooudwatch log exports in a more human-readable format.
# 
# Usage: ./troubleshoot/run.rb some-cloudwatch-log-export.log | grep JOB_ID

require 'json'

logs = []
ARGF.each do |line|
    date, json = line.split(" ", 2)
    if json.include?("SDK")
        next
    end
    log = JSON.parse(json)
    logs << log
end

logs.sort_by! { |log| log["time"] }

logs.each do |log|
    log.delete("app_stack_name")
    log.delete("app_environment")
    log.delete("job_url")
    puts [sprintf("%-12s", log.delete("app_version")), sprintf("%-21s", log.delete("time")), sprintf("%-12s", log.delete("job_id")), log.delete("message")].compact.join(" ")
    puts JSON.pretty_generate(log)
    puts ""
end
