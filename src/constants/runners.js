const RUNNERS = {
  "1cpu-linux-x64": {
    cpu: 1,
    family: ["m7a", "m6a"],
    image: "ubuntu22-full-x64",
    pricing: [0.000966, 0.00036], // m7a
  },
  "2cpu-linux-x64": {
    cpu: 2,
    family: ["m7i", "m7a"],
    image: "ubuntu22-full-x64",
    pricing: [0.001596, 0.000712], // m7i-flex
  },
  "4cpu-linux-x64": {
    cpu: 4,
    family: ["m7i", "m7a"],
    image: "ubuntu22-full-x64",
    pricing: [0.003192, 0.001473], // m7i-flex
  },
  "8cpu-linux-x64": {
    cpu: 8,
    family: ["c7i", "c7a", "m7i", "m7a"],
    image: "ubuntu22-full-x64",
    throughput: 750,
    iops: 4000,
    pricing: [0.00595, 0.002678], // c7i
  },
  "16cpu-linux-x64": {
    cpu: 16,
    family: ["c7i", "c7a", "m7i", "m7a"],
    image: "ubuntu22-full-x64",
    throughput: 750,
    iops: 4000,
    pricing: [0.0119, 0.005777], // c7i
  },
  "32cpu-linux-x64": {
    cpu: 32,
    family: ["c7i", "c7a", "m7i", "m7a"],
    image: "ubuntu22-full-x64",
    throughput: 750,
    iops: 4000,
    pricing: [0.0238, 0.010733], // c7i
  },
  "48cpu-linux-x64": {
    cpu: 48,
    family: ["c7i", "c7a", "m7i", "m7a"],
    image: "ubuntu22-full-x64",
    throughput: 1000,
    iops: 4000,
    pricing: [0.0357, 0.014802], // c7i
  },
  "64cpu-linux-x64": {
    cpu: 64,
    family: ["c7i", "c7a", "m7i", "m7a"],
    image: "ubuntu22-full-x64",
    throughput: 1000,
    iops: 4000,
    pricing: [0.0476, 0.019587], // c7i
  },
  "1cpu-linux-arm64": {
    cpu: 1,
    family: ["m7g", "t4g.medium"],
    image: "ubuntu22-full-arm64",
    pricing: [0.00068, 0.00029], // m7g
  },
  "2cpu-linux-arm64": {
    cpu: 2,
    family: ["m7g", "t4g.large"],
    pricing: [0.00136, 0.000575], // m7g
  },
  "4cpu-linux-arm64": {
    cpu: 4,
    family: ["m7g", "t4g"],
    image: "ubuntu22-full-arm64",
    pricing: [0.00272, 0.001042], // m7g
  },
  "8cpu-linux-arm64": {
    cpu: 8,
    family: ["c7g", "m7g"],
    image: "ubuntu22-full-arm64",
    throughput: 750,
    iops: 4000,
    pricing: [0.004833, 0.00193], // c7g
  },
  "16cpu-linux-arm64": {
    cpu: 16,
    family: ["c7g", "m7g"],
    throughput: 750,
    iops: 4000,
    pricing: [0.009667, 0.00415], // c7g
  },
  "32cpu-linux-arm64": {
    cpu: 32,
    family: ["c7g", "m7g"],
    image: "ubuntu22-full-arm64",
    throughput: 750,
    iops: 4000,
    pricing: [0.019333, 0.00885], // c7g
  },
  "48cpu-linux-arm64": {
    cpu: 48,
    throughput: 1000,
    iops: 4000,
    family: ["c7g", "m7g"],
    pricing: [0.029, 0.011742], // c7g
  },
  "64cpu-linux-arm64": {
    cpu: 64,
    family: ["c7g", "m7g"],
    image: "ubuntu22-full-arm64",
    throughput: 1000,
    iops: 4000,
    pricing: [0.038667, 0.0151], // c7g
  },
  // LEGACY
  "1cpu-linux": {
    cpu: 1,
    family: ["m7a", "m7g", "m7i"],
    // pricing: [0.000966, 0.000383],      // t3a
    pricing: [0.000966, 0.00038], // m7a
  },
  "2cpu-linux": {
    cpu: 2,
    family: ["m7a", "m7g", "m7i"],
    // pricing: [0.001253, 0.000505],      // t3a
    pricing: [0.001932, 0.000783], // m7a
  },
  "4cpu-linux": {
    cpu: 4,
    family: ["m7a", "m7g", "m7i", "c7a", "c7g"],
    // pricing: [0.002507, 0.001115],      // t3a
    pricing: [0.003864, 0.00185], // c7a
  },
  "8cpu-linux": {
    cpu: 8,
    family: ["c7a", "c7g", "m7i", "m7a", "m7g"],
    throughput: 750,
    iops: 4000,
    // pricing: [0.005013, 0.002325],      // t3a
    pricing: [0.006843, 0.003097], // c7a
  },
  "16cpu-linux": {
    cpu: 16,
    family: ["c7a", "c7g", "m7i", "m7a", "m7g"],
    throughput: 750,
    iops: 4000,
    pricing: [0.013685, 0.006415], // c7a
  },
  "32cpu-linux": {
    cpu: 32,
    family: ["c7a", "c7g", "m7i", "m7a", "m7g"],
    throughput: 750,
    iops: 4000,
    pricing: [0.027371, 0.012677], // c7a
  },
  "48cpu-linux": {
    cpu: 48,
    throughput: 1000,
    iops: 4000,
    family: ["c7a", "c7g", "m7i", "m7a", "m7g"],
    pricing: [0.041056, 0.016577], // c7a
  },
  "64cpu-linux": {
    cpu: 64,
    family: ["c7a", "c7g", "m7i", "m7a", "m7g"],
    throughput: 1000,
    iops: 4000,
    pricing: [0.054741, 0.020535], // c7a
  },
};

module.exports = { RUNNERS };
