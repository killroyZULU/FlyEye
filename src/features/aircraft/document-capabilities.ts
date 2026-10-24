export function aircraftDocumentCapabilities(permissions: readonly string[]) {
  const has = (permission: string) => permissions.includes(permission);
  return {
    canReadDetails: has('aircraft.document.read'),
    canReadAttachment: has('aircraft.document.attachment.read'),
    canManage: has('aircraft.document.manage'),
    canManageCategories: has('aircraft.document.category.manage'),
    canReadNotifications: has('aircraft.document.notification.read'),
  };
}
