// Copyright (c) 2025 coze-dev Authors
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';
import { useUIStore, type BreadcrumbItemConfig } from '@cozeloop/stores';
import { useRouteInfo, useNavigateModule } from '@cozeloop/biz-hooks-adapter';
// import { SwitchLang } from '@cozeloop/auth-pages';
import { IconCozArrowDown } from '@coze-arch/coze-design/icons';
import { Breadcrumb, Dropdown, Button } from '@coze-arch/coze-design';

import { useMenuConfig } from '../navbar/menu-config';
import { getBreadcrumbMap } from './utils';

export function MainBreadcrumb() {
  const { app, subModule } = useRouteInfo();
  const { breadcrumbConfig, setBreadcrumbConfig } = useUIStore(
    useShallow(store => ({
      breadcrumbConfig: store.breadcrumbConfig,
      setBreadcrumbConfig: store.setBreadcrumbConfig,
    })),
  );

  const menuConfig = useMenuConfig();
  const [breadcrumbMap] = useState(getBreadcrumbMap(menuConfig));
  const navigate = useNavigateModule();

  useEffect(() => {
    const config: BreadcrumbItemConfig[] = [];
    if (breadcrumbMap[app]) {
      config.push(breadcrumbMap[app]);
    }
    if (breadcrumbMap[`${app}/${subModule}`]) {
      config.push(breadcrumbMap[`${app}/${subModule}`]);
    }
    setBreadcrumbConfig(config);
  }, [app, subModule]);

  const handleClick = (config: BreadcrumbItemConfig) => {
    navigate(`${config.path}`);
  };

  // 设置浏览器标签页标题
  useEffect(() => {
    const text = breadcrumbConfig
      .map(item => item.text)
      .filter(Boolean)
      .join(' - ');
    if (document.title !== text) {
      document.title = text;
    }
  }, [breadcrumbConfig]);

  // 当前激活的模块名
  const activeGroup = menuConfig.find(g => g.itemKey === app);

  return (
    <div className="h-[56px] flex items-center justify-between px-6 border-0 border-b border-solid coz-stroke-primary">
      <div className="flex items-center gap-2">
        {/* 模块切换 */}
        <Dropdown
          position="bottomLeft"
          render={
            <div className="py-1 min-w-[200px]">
              {menuConfig
                .filter(g => g.items && g.items.length > 0 && !g.hideInNavbar)
                .map(group => (
                  <div key={group.itemKey}>
                    <div className="px-3 pt-2 pb-1 text-[11px] font-medium coz-fg-secondary uppercase">
                      {group.text}
                    </div>
                    {group.items
                      ?.filter(item => !item.hideInNavbar)
                      .map(item => (
                        <div
                          key={item.itemKey}
                          className="flex items-center gap-2 px-3 py-[6px] cursor-pointer coz-fg-primary hover:coz-mg-primary"
                          onClick={() => navigate(item.itemKey)}
                        >
                          <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                            {item.icon}
                          </span>
                          <span className="text-[13px]">{item.text}</span>
                        </div>
                      ))}
                  </div>
                ))}
            </div>
          }
        >
          <Button
            type="tertiary"
            className="flex items-center gap-1 !px-2 !text-[13px]"
            icon={<IconCozArrowDown />}
            iconPosition="right"
          >
            {activeGroup?.text || '模块'}
          </Button>
        </Dropdown>

        {/* 面包屑 */}
        <Breadcrumb
          separator={<div className="rotate-[22deg] coz-fg-dim">/</div>}
        >
          {breadcrumbConfig.map((c, index) => (
            <Breadcrumb.Item
              key={c.path || index}
              onClick={() => {
                if (index !== 0 && index !== breadcrumbConfig.length - 1) {
                  handleClick(c);
                }
              }}
            >
              <span
                className={`!text-[13px] ${index === 0 ? 'cursor-default coz-fg-secondary' : ''}`}
              >
                {c.text}
              </span>
            </Breadcrumb.Item>
          ))}
        </Breadcrumb>
      </div>
      {/* <SwitchLang /> */}
    </div>
  );
}
