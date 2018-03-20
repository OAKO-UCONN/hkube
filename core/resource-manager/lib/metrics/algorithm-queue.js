
const Metric = require('./Metric');
const MAX_SCORE = 10;

class AlgorithmQueueMetric extends Metric {

    constructor(options) {
        super(options);
    }

    /**
     * This method 
     * 
     * @param {any} data 
     * 
     * @memberOf AlgorithmQueueMetric
     */
    calc(data) {
        const algorithmQueue = data.algorithmQueue.map(q => {
            return {
                ...q,
                score: this.weight * q.score
            }
        });
        const result = {
            ...data,
            algorithmQueue
        }
        return result;
    }

    _normalize(score) {
        return (score < MAX_SCORE ? MAX_SCORE - score + 1 : MAX_SCORE) / MAX_SCORE;
    }
}

module.exports = AlgorithmQueueMetric;