//job-queue.js
class JobQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.maxConcurrent = 2; // Process 2 jobs at a time
        this.currentJobs = 0;
    }

    addJob(job) {
        this.queue.push(job);
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing || this.currentJobs >= this.maxConcurrent) return;
        
        this.isProcessing = true;
        
        while (this.queue.length > 0 && this.currentJobs < this.maxConcurrent) {
            const job = this.queue.shift();
            this.currentJobs++;
            
            // Process job in background without blocking
            setTimeout(async () => {
                try {
                    await job();
                } catch (error) {
                    console.error('Job failed:', error.message);
                } finally {
                    this.currentJobs--;
                    this.processQueue();
                }
            }, 0);
        }
        
        this.isProcessing = false;
    }
}

module.exports = new JobQueue();