/** 玉子美化 Runtime API v1 作者类型声明。 */

export type YuziBeautifyApiVersion = 1;

export type YuziBeautifyStateChangeReason = "table-data" | "navigation-state";

export interface YuziBeautifyStateChangeMeta {
  readonly reason: YuziBeautifyStateChangeReason;
}

/**
 * 宿主提供的当前单表快照。
 *
 * 运行时会递归冻结实际对象；`unknown` 单元格中若包含对象或数组，也不可原地修改。
 */
export interface YuziBeautifyState {
  readonly version: number;
  readonly sheetKey: string;
  readonly tableName: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly route: string;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
}

export type YuziBeautifyActionName =
  | "back"
  | "previousTable"
  | "nextTable"
  | "editCurrentTable";

export type YuziBeautifyActionStatus =
  | "navigated"
  | "stale"
  | "unavailable"
  | "failed";

export interface YuziBeautifyNavigatedResult<A extends YuziBeautifyActionName> {
  readonly ok: true;
  readonly action: A;
  readonly status: "navigated";
  readonly fromRoute: string;
  readonly targetRoute?: string;
}

export interface YuziBeautifyUnavailableResult<A extends YuziBeautifyActionName> {
  readonly ok: false;
  readonly action: A;
  readonly status: "stale" | "unavailable";
  readonly fromRoute: string;
}

export interface YuziBeautifyFailedResult<A extends YuziBeautifyActionName> {
  readonly ok: false;
  readonly action: A;
  readonly status: "failed";
  readonly fromRoute: string;
  readonly errorCode: string;
  readonly message: string;
}

export type YuziBeautifyActionResult<A extends YuziBeautifyActionName = YuziBeautifyActionName> =
  | YuziBeautifyNavigatedResult<A>
  | YuziBeautifyUnavailableResult<A>
  | YuziBeautifyFailedResult<A>;

export interface YuziBeautifyActions {
  back(): Promise<YuziBeautifyActionResult<"back">>;
  previousTable(): Promise<YuziBeautifyActionResult<"previousTable">>;
  nextTable(): Promise<YuziBeautifyActionResult<"nextTable">>;
  editCurrentTable(): Promise<YuziBeautifyActionResult<"editCurrentTable">>;
}

export interface YuziBeautifyPresetAssets {
  getUrl(slot: string): Promise<string | null>;
  save(slot: string, image: Blob): Promise<string>;
  delete(slot: string): Promise<void>;
}

export type YuziBeautifyStateListener = (
  state: YuziBeautifyState,
  meta: YuziBeautifyStateChangeMeta,
) => void;

export type YuziBeautifyUnsubscribe = () => void;
export type YuziBeautifyDisposer = () => void;

export interface YuziBeautifyRuntimeContext {
  readonly apiVersion: 1;
  readonly root: HTMLElement;
  readonly signal: AbortSignal;
  readonly actions: Readonly<YuziBeautifyActions>;
  readonly presetAssets: Readonly<YuziBeautifyPresetAssets>;

  getState(): YuziBeautifyState;
  subscribe(listener: YuziBeautifyStateListener): YuziBeautifyUnsubscribe;

  /**
   * 把最终 Bundle `files` 中的精确包路径解析为实例期 Blob URL。
   * 路径不存在时抛出 Error；URL 在实例销毁后失效。
   */
  resolveAsset(packagePath: string): string;
}

export type YuziBeautifyMountResult =
  | void
  | YuziBeautifyDisposer
  | Promise<void | YuziBeautifyDisposer>;

/** 每个 `entry.mount` 必须提供的显式命名导出。 */
export declare function mount(context: YuziBeautifyRuntimeContext): YuziBeautifyMountResult;
