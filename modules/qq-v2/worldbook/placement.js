const SILLY_TAVERN_AT_DEPTH_POSITION = 4;
const SILLY_TAVERN_SYSTEM_ROLE = 0;

export function qqV2WorldbookPlacement(depth) {
    const value = Number(depth);
    if (!Number.isInteger(value) || value < 0) {
        throw new TypeError('QQ 世界书深度必须是 0 或更大的整数');
    }
    return {
        position: SILLY_TAVERN_AT_DEPTH_POSITION,
        depth: value,
        role: SILLY_TAVERN_SYSTEM_ROLE,
    };
}

export const QQ_V2_WORLDBOOK_AT_DEPTH_POSITION = SILLY_TAVERN_AT_DEPTH_POSITION;
