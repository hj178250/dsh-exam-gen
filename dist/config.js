// 运行开关：用户想「这次先别用插件」时，把 enabled 关掉即可。
// 存在 ~/.dsh/exam-gen.json，插件和管理页共用这一份。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
// 甲方要求：插件首次出现时默认关闭，用户点侧栏「出题」开关才启用。
const DEFAULT_CONFIG = { enabled: false };
export function configPath() {
    const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh');
    return join(home, 'exam-gen.json');
}
export function readConfig() {
    try {
        const file = configPath();
        if (!existsSync(file))
            return { ...DEFAULT_CONFIG };
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return { enabled: parsed.enabled !== false };
    }
    catch {
        // 配置读坏了就当开着，别因为一个 JSON 让人以为插件没了
        return { ...DEFAULT_CONFIG };
    }
}
export function writeConfig(next) {
    const file = configPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
