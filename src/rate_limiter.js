class RateLimiter {
  constructor(tokensPerInterval, interval, { logger, name }) {
    this.tokensPerInterval = tokensPerInterval;
    this.interval = interval || 1000;
    this.logger = logger;
    this.name = name || "RateLimiter";
    this.maxTokens = this.tokensPerInterval;
    this.tokens = this.tokensPerInterval;
    this.queue = [];
    this.schedule();
  }

  schedule() {
    this.timeout = setTimeout(() => this.renewTokens(), this.interval);
  }

  stop() {
    clearTimeout(this.timeout);
  }

  renewTokens() {
    this.tokens = this.tokensPerInterval;
    try {
      while (this.tokens > 0 && this.queue.length > 0) {
        this.logger.info(
          `${this.name} tokens=${this.tokens} queue=${this.queue.length}`
        );
        const nextResolve = this.queue.shift();
        this.tokens--;
        nextResolve();
      }
    } catch (err) {
      this.logger.error(`${this.name} error`, err);
    }
    this.schedule();
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
}

module.exports = RateLimiter;
