function buildMutationFailure(code, message, extra = {}) {
    return {
        ok: false,
        code,
        message,
        result: null,
        changes: null,
        errors: [],
        ...extra,
    };
}

function readFailureCode(result, fallbackCode = 'mutation_failed') {
    const code = typeof result?.code === 'string' ? result.code.trim() : '';
    return code && code !== 'ok' ? code : fallbackCode;
}

function readFailureMessage(result, fallbackMessage) {
    const message = typeof result?.message === 'string' ? result.message.trim() : '';
    return message || fallbackMessage;
}

/**
 * Normalize the settlement returned by shujuku's executeSqlMutation API.
 *
 * A zero-row mutation is still a valid settlement. Callers that require a
 * specific affected-row count must reconcile that business condition after
 * this structural contract has been confirmed.
 */
export function normalizeSqlMutationSettlement(result) {
    if (result === null) {
        return buildMutationFailure('mutation_result_null', 'SQL 写入 API 返回 null');
    }
    if (result === undefined) {
        return buildMutationFailure('mutation_result_invalid', 'SQL 写入返回 undefined');
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return buildMutationFailure('mutation_result_invalid', 'SQL 写入返回值不是对象', { rawResult: result });
    }
    if (!('errors' in result) || !Array.isArray(result.errors)) {
        return buildMutationFailure('mutation_result_invalid', 'SQL 写入缺少合法的 errors 数组', { result });
    }
    if (!Number.isInteger(result.changes) || result.changes < 0) {
        return buildMutationFailure('mutation_result_invalid', 'SQL 写入缺少合法的非负整数 changes', {
            result,
            errors: result.errors,
        });
    }

    const errors = result.errors;
    if (errors.length > 0) {
        return buildMutationFailure('mutation_failed', readFailureMessage(result, 'SQL 写入返回错误'), {
            result,
            errors,
        });
    }
    if (result.saved === false) {
        return buildMutationFailure('save_failed', readFailureMessage(result, 'SQL 写入未确认保存成功'), {
            result,
            errors,
        });
    }
    if ('ok' in result && result.ok === false) {
        return buildMutationFailure(
            readFailureCode(result),
            readFailureMessage(result, 'SQL 写入未确认成功'),
            { result, errors },
        );
    }
    if ('success' in result && result.success === false) {
        return buildMutationFailure(
            readFailureCode(result),
            readFailureMessage(result, 'SQL 写入未确认成功'),
            { result, errors },
        );
    }

    return {
        ok: true,
        code: 'ok',
        message: typeof result.message === 'string' && result.message.trim()
            ? result.message.trim()
            : 'SQL 写入成功',
        result,
        changes: result.changes,
        saved: result.saved,
        errors,
    };
}
