/**
 * 题库里的题干/选项/解析混着 LaTeX（`$\frac{1}{2}$`、`\pm`、`\sqrt{3}` 之类）。
 * 这些直接丢给聊天窗口，KaTeX 一渲染失败就变成「2 2 与 1 2 2 1」那种碎行；
 * 丢给 pdfkit 更是原样打出来。
 *
 * 所以统一在进数据层之前转成纯文本：分数写成 1/2、乘号写成 ×、根号写成 √。
 * pdf.ts 的 splitMath 会把 1/2 再排成上下结构，因此这里只负责「去掉 LaTeX 语法」。
 */
const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
    pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ',
    psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS = {
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
    equiv: '≡', sim: '∼', propto: '∝', infty: '∞', angle: '∠',
    triangle: '△', perp: '⊥', parallel: '∥', circ: '°', degree: '°',
    because: '∵', therefore: '∴', in: '∈', notin: '∉', subset: '⊂',
    subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅', forall: '∀',
    exists: '∃', sum: '∑', prod: '∏', int: '∫', rightarrow: '→', to: '→',
    leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
    cdots: '⋯', ldots: '…', dots: '…', quad: ' ', qquad: '  ',
    '%': '%', '&': '', '#': '#', '_': '_',
};
/** 把 \frac{1}{2} 这类两段参数抽出来（支持嵌套一层括号） */
function readGroup(input, start) {
    let i = start;
    while (i < input.length && /\s/.test(input[i]))
        i++;
    if (input[i] !== '{') {
        // \frac12 这种省括号写法：只取一个字符
        if (i < input.length)
            return { text: input[i], end: i + 1 };
        return null;
    }
    let depth = 0;
    const from = i + 1;
    for (; i < input.length; i++) {
        const ch = input[i];
        if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return { text: input.slice(from, i), end: i + 1 };
        }
    }
    return null;
}
export function stripLatex(input) {
    if (!input || input.indexOf('\\') === -1 && input.indexOf('$') === -1)
        return input;
    let s = input;
    // 定界符先去掉
    s = s.replace(/\$\$?/g, '');
    // 分数：\frac{a}{b} / \dfrac / \tfrac → a/b（pdf 那边会排成真分式）
    for (let guard = 0; guard < 8; guard++) {
        const idx = s.search(/\\(?:d|t)?frac\s*/);
        if (idx < 0)
            break;
        const head = s.slice(0, idx);
        const rest = s.slice(idx).replace(/^\\(?:d|t)?frac\s*/, '');
        const num = readGroup(rest, 0);
        if (!num)
            break;
        const den = readGroup(rest, num.end);
        if (!den)
            break;
        s = head + '(' + stripLatex(num.text) + ')/(' + stripLatex(den.text) + ')' + rest.slice(den.end);
    }
    // 单层分数不必带括号，让 splitMath 更好认
    s = s.replace(/\(([^()]{1,24})\)\/\(([^()]{1,24})\)/g, (m, a, b) => /[+\-*/]/.test(a) || /[+\-*/]/.test(b) ? m : `${a}/${b}`);
    // \sqrt{x} → √x，\sqrt[3]{x} → ³√x
    s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_m, n, x) => `${n}√${x}`);
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, x) => `√${x}`);
    // \text{…} / \mathrm{…} / \mathbf{…} → 内容
    s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, (_m, x) => x);
    // ^{2} / _{1} → 上标字符或直接去掉花括号
    s = s.replace(/\^\{([^{}]*)\}/g, (_m, x) => (x.length === 1 ? `^${x}` : `^${x}`));
    s = s.replace(/_\{([^{}]*)\}/g, (_m, x) => x);
    s = s.replace(/\^([0-9])/g, '^$1');
    // 希腊字母与常用符号
    s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] ?? SYMBOLS[name] ?? '');
    s = s.replace(/\\([%&_#])/g, (_m, ch) => SYMBOLS[ch] ?? ch);
    // 剩下的 \left \right \, \; \! 之类
    s = s.replace(/\\left|\\right|\\[,;:!]/g, '');
    s = s.replace(/\\/g, '');
    // \quad 之类已经被替换成空格了，收一下多余的
    return s.replace(/[ \t]{2,}/g, ' ').trim();
}
/** 数组里的每一项都过一遍（选项、解析之类） */
export function stripLatexList(list) {
    if (!list)
        return list;
    return list.map((item) => stripLatex(item));
}
