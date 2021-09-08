import React from "react";
import {DockContext, DockContextType, DropDirection, PanelData, TabData, TabGroup} from "./DockData";
import {compareArray, compareKeys} from "./util/Compare";
import Tabs from 'rc-tabs';
import Menu, {MenuItem} from 'rc-menu';
import Dropdown from 'rc-dropdown';
import * as DragManager from "./dragdrop/DragManager";
import {DragDropDiv} from "./dragdrop/DragDropDiv";
import {DockTabBar} from "./DockTabBar";
import DockTabPane from "./DockTabPane";
import {getFloatPanelSize} from "./Algorithm";
import {WindowBox} from "./WindowBox";

function findParentPanel(element: HTMLElement) {
  for (let i = 0; i < 10; ++i) {
    if (!element) {
      return null;
    }
    if (element.classList.contains('dock-panel')) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function isPopupDiv(r: HTMLDivElement): boolean {
  return (r == null || r.parentElement?.tagName === 'LI' || r.parentElement?.parentElement.tagName === 'LI');
}

export class TabCache {


  _ref: HTMLDivElement;
  getRef = (r: HTMLDivElement) => {
    if (isPopupDiv(r)) {
      return;
    }
    this._ref = r;
  };

  _hitAreaRef: HTMLDivElement;
  getHitAreaRef = (r: HTMLDivElement) => {
    if (isPopupDiv(r)) {
      return;
    }
    this._hitAreaRef = r;
  };

  data: TabData;
  context: DockContext;
  content: React.ReactElement;

  constructor(context: DockContext) {
    this.context = context;
  }

  setData(data: TabData) {
    if (data !== this.data) {
      this.data = data;
      this.content = this.render();
      return true;
    }
    return false;
  }

  onCloseClick = (e: React.MouseEvent) => {
    this.context.dockMove(this.data, null, 'remove');
    e.stopPropagation();
  };

  onDragStart = (e: DragManager.DragState) => {
    let panel = findParentPanel(this._ref);
    let tabGroup = this.context.getGroup(this.data.group);
    let [panelWidth, panelHeight] = getFloatPanelSize(panel, tabGroup);

    e.setData({tab: this.data, panelSize: [panelWidth, panelHeight]}, this.context.getDockId());
    e.startDrag(this._ref.parentElement, this._ref.parentElement);
  };
  onDragOver = (e: DragManager.DragState) => {
    let dockId = this.context.getDockId();
    let tab: TabData = DragManager.DragState.getData('tab', dockId);
    let panel: PanelData = DragManager.DragState.getData('panel', dockId);
    let group: string;
    if (tab) {
      panel = tab.parent;
      group = tab.group;
    } else {
      // drag whole panel
      if (!panel) {
        return;
      }
      if (panel?.panelLock) {
        e.reject();
        return;
      }
      group = panel.group;
    }
    if (group !== this.data.group) {
      e.reject();
    } else if (tab && tab !== this.data) {
      let direction = this.getDropDirection(e);
      this.context.setDropRect(this._hitAreaRef, direction, this);
      e.accept('');
    } else if (panel && panel !== this.data.parent) {
      let direction = this.getDropDirection(e);
      this.context.setDropRect(this._hitAreaRef, direction, this);
      e.accept('');
    }
  };
  onDragLeave = (e: DragManager.DragState) => {
    this.context.setDropRect(null, 'remove', this);
  };
  onDrop = (e: DragManager.DragState) => {
    let dockId = this.context.getDockId();
    let panel: PanelData;
    let tab: TabData = DragManager.DragState.getData('tab', dockId);
    if (tab) {
      panel = tab.parent;
    } else {
      panel = DragManager.DragState.getData('panel', dockId);
    }
    if (tab && tab !== this.data) {
      let direction = this.getDropDirection(e);
      this.context.dockMove(tab, this.data, direction);
    } else if (panel && panel !== this.data.parent) {
      let direction = this.getDropDirection(e);
      this.context.dockMove(panel, this.data, direction);
    }
  };

  getDropDirection(e: DragManager.DragState): DropDirection {
    let rect = this._hitAreaRef.getBoundingClientRect();
    let midx = rect.left + rect.width * 0.5;
    return e.clientX > midx ? 'after-tab' : 'before-tab';
  }

  render(): React.ReactElement {
    let {id, title, group, content, closable, cached, parent} = this.data;
    let {onDragStart, onDragOver, onDrop, onDragLeave} = this;
    if (parent.parent.mode === 'window') {
      onDragStart = null;
      onDragOver = null;
      onDrop = null;
      onDragLeave = null;
    }
    let tabGroup = this.context.getGroup(group);
    if (typeof content === 'function') {
      content = content(this.data);
    }
    let tab = (
      <DragDropDiv getRef={this.getRef} onDragStartT={onDragStart}
                   onDragOverT={onDragOver} onDropT={onDrop} onDragLeaveT={onDragLeave}>
        {title}
        {closable ?
          <div className="dock-tab-close-btn" onClick={this.onCloseClick}/>
          : null
        }
        <div className="dock-tab-hit-area" ref={this.getHitAreaRef}/>
      </DragDropDiv>
    );

    return (
      <DockTabPane key={id} cacheId={id} cached={cached} tab={tab}>
        {content}
      </DockTabPane>
    );
  }


  destroy() {
    // place holder
  }
}

interface Props {
  panelData: PanelData;
  onPanelDragStart: DragManager.DragHandler;
  onPanelDragMove: DragManager.DragHandler;
  onPanelDragEnd: DragManager.DragHandler;
}

interface State {

}

export class DockTabs extends React.PureComponent<Props, any> {
  static contextType = DockContextType;

  static readonly propKeys = ['group', 'tabs', 'activeId', 'onTabChange'];

  context!: DockContext;
  _cache: Map<string, TabCache> = new Map();

  cachedTabs: TabData[];

  updateTabs(tabs: TabData[]) {
    if (tabs === this.cachedTabs) {
      return;
    }
    this.cachedTabs = tabs;
    let newCache = new Map<string, TabCache>();
    let reused = 0;
    for (let tabData of tabs) {
      let {id} = tabData;
      if (this._cache.has(id)) {
        let tab = this._cache.get(id);
        newCache.set(id, tab);
        tab.setData(tabData);
        ++reused;
      } else {
        let tab = new TabCache(this.context);
        newCache.set(id, tab);
        tab.setData(tabData);
      }
    }
    if (reused !== this._cache.size) {
      for (let [id, tab] of this._cache) {
        if (!newCache.has(id)) {
          tab.destroy();
        }
      }
    }
    this._cache = newCache;
  }

  onMaximizeClick = (e: React.MouseEvent) => {
    let {panelData} = this.props;
    this.context.dockMove(panelData, null, 'maximize');
    // prevent the focus change logic
    e.stopPropagation();
  };
  onNewWindowClick = () => {
    let {panelData} = this.props;
    this.context.dockMove(panelData, null, 'new-window');
  };

  addNewWindowMenu(element: React.ReactElement, showWithLeftClick: boolean) {
    const nativeMenu = (
      <Menu onClick={this.onNewWindowClick}>
        <MenuItem>
          New Window
        </MenuItem>
      </Menu>
    );
    let trigger = showWithLeftClick ? ['contextMenu', 'click'] : ['contextMenu'];
    return (
      <Dropdown
        prefixCls="dock-dropdown"
        overlay={nativeMenu}
        trigger={trigger}
        mouseEnterDelay={0.1}
        mouseLeaveDelay={0.1}>
        {element}
      </Dropdown>
    );
  }

  renderTabBar = (props: any, TabNavList: React.ComponentType) => {
    let {panelData, onPanelDragStart, onPanelDragMove, onPanelDragEnd} = this.props;
    let {group: groupName, panelLock} = panelData;
    let group = this.context.getGroup(groupName);
    let {panelExtra} = group;

    let maximizable = group.maximizable;
    if (panelData.parent.mode === 'window') {
      onPanelDragStart = null;
      maximizable = false;
    }

    if (panelLock) {
      if (panelLock.panelExtra) {
        panelExtra = panelLock.panelExtra;
      }
    }

    let showNewWindowButton = group.newWindow && WindowBox.enabled && panelData.parent.mode === 'float';

    let panelExtraContent: React.ReactElement;
    if (panelExtra) {
      panelExtraContent = panelExtra(panelData, this.context);
    } else if (maximizable || showNewWindowButton) {
      panelExtraContent = <div className="dock-panel-max-btn" onClick={maximizable ? this.onMaximizeClick : null}/>;
      if (showNewWindowButton) {
        panelExtraContent = this.addNewWindowMenu(panelExtraContent, !maximizable);
      }
    }
    let noHide = panelData.tabs.some((tab:any) => tab.noAutoHide);
    return (
      <DockTabBar onDragStart={onPanelDragStart} onDragMove={onPanelDragMove} onDragEnd={onPanelDragEnd}
                  TabNavList={TabNavList} isMaximized={panelData.parent.mode === 'maximize'} className={((panelData.tabs.length === 1 && panelData.parent.mode !== 'float' && !noHide)?"dock-bar-autohide":"")} {...props}
                  extra={panelExtraContent}/>
    );
  };

  onTabChange = (activeId: string) => {
    this.props.panelData.activeId = activeId;
    this.context.onSilentChange(activeId, 'active');
    this.forceUpdate();
  };

  render(): React.ReactNode {
    let {group, tabs, activeId} = this.props.panelData;
    let tabGroup = this.context.getGroup(group);
    let {animated} = tabGroup;
    if (animated == null) {
      animated = true;
    }

    this.updateTabs(tabs);

    let children: React.ReactNode[] = [];
    for (let [id, tab] of this._cache) {
      children.push(tab.content);
    }

    return (
      <Tabs prefixCls="dock"
            moreIcon="..."
            animated={animated}
            renderTabBar={this.renderTabBar}
            activeKey={activeId}
            onChange={this.onTabChange}
      >
        {children}
      </Tabs>
    );
  }
}
