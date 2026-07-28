// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
/// <reference types="@rsbuild/core/types" />
/// <reference types="@cozeloop/rsbuild-config/types" />

declare module '*.svg' {
  export const ReactComponent: React.FunctionComponent<
    React.SVGProps<SVGSVGElement>
  >;

  /**
   * The default export type depends on the svgDefaultExport config,
   * it can be a string or a ReactComponent
   * */
  const content: any;
  export default content;
}

declare type Int64 = string | number;

// ====== wujie 微前端类型声明 ======
interface WujieInstance {
  props: Record<string, unknown>;
}

declare interface Window {
  /** wujie 注入：标识当前运行在 wujie 沙箱中 */
  __POWERED_BY_WUJIE__?: boolean;
  /** wujie 注入：当前 wujie 实例 */
  $wujie?: WujieInstance;
  /** 子应用挂载生命周期（由子应用注册，wujie 调用） */
  __WUJIE_MOUNT?: () => void;
  /** 子应用卸载生命周期（由子应用注册，wujie 调用） */
  __WUJIE_UNMOUNT?: () => void;
}
