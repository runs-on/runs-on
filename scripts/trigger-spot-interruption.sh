#!/bin/bash
set -exo pipefail

# https://github.com/aws/amazon-ec2-spot-interrupter

# Install tool
#   brew tap aws/tap
#   brew install ec2-spot-interrupter

# Tool requires the following trust policy set in the current role:
# {
#     "Effect": "Allow",
#     "Principal": {
#         "Service": "fis.amazonaws.com"
#     },
#     "Action": "sts:AssumeRole"
# }

ec2-spot-interrupter --delay 2s --instance-ids "$@"