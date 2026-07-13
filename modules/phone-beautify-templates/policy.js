export const BEAUTIFY_USER_TEMPLATE_WRITE_DISABLED = 'BEAUTIFY_USER_TEMPLATE_WRITE_DISABLED';

export function createBeautifyUserTemplateWriteDisabledResult(overrides = {}) {
    return {
        success: false,
        code: BEAUTIFY_USER_TEMPLATE_WRITE_DISABLED,
        message: '用户模板管理功能已停用，请使用模板工坊恢复内置默认',
        ...overrides,
    };
}
