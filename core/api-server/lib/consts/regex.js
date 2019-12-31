const Regex = {
    JOB_ID_PREFIX_REGEX: /.+:(.+:)?/,
    URL_REGEX: /^(f|ht)tps?:\/\//i,
    PIPELINE_NAME_REGEX: /^[:\-_.A-Za-z0-9]+$/i,
    ALGORITHM_NAME_REGEX: /^[a-z0-9][-a-z0-9\\.]*[a-z0-9]$/,
    ALGORITHM_IMAGE_REGEX: /^\S*$/,
    BOARD_ID: /^([:\-A-z0-9^._])*[^\s]\1*$/,
    PATH: /^([A-z0-9.\\-|/])*[^\s]\1*$/
};

module.exports = Regex;
