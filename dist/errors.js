export class QuizError extends Error {
    code;
    /** 可以直接给用户看的一句话。 */
    userMessage;
    constructor(code, userMessage, detail) {
        super(detail === undefined ? userMessage : `${userMessage} :: ${stringify(detail)}`);
        this.name = 'QuizError';
        this.code = code;
        this.userMessage = userMessage;
    }
}
function stringify(detail) {
    if (typeof detail === 'string')
        return detail;
    try {
        return JSON.stringify(detail);
    }
    catch {
        return String(detail);
    }
}
