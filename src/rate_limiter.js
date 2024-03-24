class RateLimiter {
  constructor(tokensPerInterval, interval) {
    this.tokens = 0;
    this.maxTokens = tokensPerInterval;
    this.queue = [];
    this.interval = setInterval(
      () => this.renewTokens(tokensPerInterval),
      interval || 1000
    );
  }

  stop() {
    clearInterval(this.interval);
  }

  renewTokens(tokensPerInterval) {
    console.log("tokens", this.tokens);
    this.tokens = tokensPerInterval;
    while (this.tokens > 0 && this.queue.length > 0) {
      console.log("renewTokens", this.tokens, this.queue.length);
      const nextResolve = this.queue.shift();
      this.tokens--;
      setImmediate(() => nextResolve);
      // process.nextTick(nextResolve);
      // nextResolve();
    }
  }

  async waitForToken() {
    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    } else {
      return new Promise((resolve) => {
        this.queue.push(resolve);
      });
    }
  }
  // async waitForToken() {
  //   while (this.tokens === 0) {
  //     await new Promise((resolve) => setTimeout(resolve, 1000));
  //   }
  //   this.tokens--;
  // }
}
module.exports = RateLimiter;
