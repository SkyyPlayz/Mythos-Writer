// F3#6 — TimelinePicker is now the hierarchical tree sidebar.
// Kept as the public import name so existing call sites / tests keep working.
export { default, buildTimelineTreeRows } from './TimelineTreeSidebar';
export type { TimelineTreeSidebarProps as TimelinePickerProps, TimelineTreeNode } from './TimelineTreeSidebar';
