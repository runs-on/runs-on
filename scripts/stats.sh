#!/usr/bin/env bash

# Extract timestamps from JSON log lines and calculate average occurrences per second
# Usage: cat logfile | ./scripts/stats.sh
# Or: ./scripts/stats.sh < logfile

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed. Install it with: brew install jq" >&2
    exit 1
fi

VERBOSE=0
if [ "$1" == "--verbose" ] || [ "$1" == "-v" ]; then
    VERBOSE=1
fi

# Extract timestamps and process with awk
jq -r '.time // empty' 2>/dev/null | \
awk -v verbose="$VERBOSE" '
{
    if ($0 == "" || $0 == "null") {
        next
    }
    
    # Parse ISO8601 timestamp and extract seconds precision
    # Format: 2025-11-13T09:29:00.436+01:00 -> 2025-11-13T09:29:00
    match($0, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/)
    if (RSTART > 0) {
        second_key = substr($0, RSTART, RLENGTH)
        counts[second_key]++
        total_occurrences++
    }
}

END {
    total_seconds = length(counts)
    
    if (total_seconds == 0) {
        print "Statistics:"
        print "  Total occurrences: 0"
        print "  Total seconds: 0"
        print "  Average per second: 0.00"
        print "  Max per second: 0"
        print "  Min per second: 0"
        exit
    }
    
    # Find max and min
    max_per_second = 0
    min_per_second = 999999
    for (key in counts) {
        if (counts[key] > max_per_second) {
            max_per_second = counts[key]
        }
        if (counts[key] < min_per_second) {
            min_per_second = counts[key]
        }
    }
    
    # Calculate average
    avg_per_second = total_occurrences / total_seconds
    
    # Output results
    print "Statistics:"
    printf "  Total occurrences: %d\n", total_occurrences
    printf "  Total seconds: %d\n", total_seconds
    printf "  Average per second: %.2f\n", avg_per_second
    printf "  Max per second: %d\n", max_per_second
    printf "  Min per second: %d\n", min_per_second
    
    # Optional: show distribution per second
    if (verbose == 1) {
        print ""
        print "Distribution per second:"
        # Sort keys for output
        n = asorti(counts, sorted_keys)
        for (i = 1; i <= n; i++) {
            printf "  %s: %d\n", sorted_keys[i], counts[sorted_keys[i]]
        }
    }
}
'
