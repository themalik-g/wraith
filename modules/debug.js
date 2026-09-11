import util from 'util';

const dye = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey = s => dye(90, s);
const cyan = s => dye(36, s);
const violet = s => dye(35, s);

/**
 * Safely trace structured data
 * @param {string} tag
 * @param {any} data
 */
export function trace(tag, data) {
    try {
        const time = new Date().toISOString().substring(11, 19);
        const prefix = `${grey(`[${time}]`)} ${violet('🔍')} ${cyan(`[${tag}]`)}`;
        if (typeof data === 'object' && data !== null) {
            const formattedData = util.inspect(data, { colors: true, depth: 3, compact: true });
            console.log(`${prefix} ${formattedData}`);
        } else {
            console.log(`${prefix} ${data}`);
        }
    } catch (e) {
        // Silent safety fallback: trace errors will not disrupt application flow
    }
}

/**
 * Safely trace a single log line
 * @param {string} tag
 * @param {string} message
 */
export function traceLine(tag, message) {
    try {
        const time = new Date().toISOString().substring(11, 19);
        const prefix = `${grey(`[${time}]`)} ${violet('🔍')} ${cyan(`[${tag}]`)}`;
        console.log(`${prefix} ${message}`);
    } catch (e) {
        // Silent safety fallback: trace errors will not disrupt application flow
    }
}
