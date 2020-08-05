const _calcRate = (list) => {
    let first = list[0];
    if (list.length === 1) {
        first = { time: first.time - 2000, count: 0 };
    }
    const last = list[list.length - 1];
    const timeDiff = (last.time - first.time) / 1000;
    const countDiff = last.count - first.count;
    const rate = countDiff / timeDiff;
    return rate;
};

/**
 * Ratio example:
 * (req msgPer sec / res msgPer sec) = ratio
 * (300 / 120) = 2.5
 * The response is 2.5 times slower than request
 * So we need to scale up current replicas * 2.5
 * If the ratio is 0.5 we need to scale down.
 * The desired ratio is approximately 1
 */
const reqResRatio = (data) => {
    const reqRate = _calcRate(data.requests);
    let resRate = _calcRate(data.responses);
    if (!resRate) {
        resRate = reqRate / 2;
    }
    return { reqRate, resRate };
};

module.exports = {
    reqResRatio
};