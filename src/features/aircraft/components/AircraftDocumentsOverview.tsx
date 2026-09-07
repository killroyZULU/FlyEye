import { useState } from 'react';

import {
  documentStatusLabel,
  type AircraftDocumentNotification,
  type DocumentAircraftList,
  type DocumentStatusList,
} from '../aircraft-documents';

type StatusItem = DocumentStatusList['items'][number];

type Props = {
  aircraft: DocumentAircraftList['aircraft'];
  selectedId?: string;
  status?: DocumentStatusList;
  notifications: AircraftDocumentNotification[];
  busy: boolean;
  online: boolean;
  message?: string;
  announcement?: string;
  canReadDetails: boolean;
  canManage: boolean;
  canManageCategories: boolean;
  onClose: () => void;
  onLoadMoreAircraft?: () => void;
  onLoadMoreNotifications?: () => void;
  onSelect: (aircraftId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onOpenNotification: (notificationId: string) => void;
  onCreateDocument: (item: StatusItem) => void;
  onCreateCategory: (label: string) => Promise<void>;
  onAssignCategory: (
    category: DocumentStatusList['availableCustomCategories'][number],
  ) => Promise<void>;
  onRenameCategory: (item: StatusItem, label: string) => Promise<void>;
  onRemoveCategory: (item: StatusItem) => Promise<void>;
  onArchiveCategory: (item: StatusItem) => Promise<void>;
};

export function AircraftDocumentsOverview(props: Props) {
  const [categoryLabel, setCategoryLabel] = useState('');
  const [availableCategoryId, setAvailableCategoryId] = useState('');
  const [renamingCategoryId, setRenamingCategoryId] = useState<string>();
  const [renamedCategoryLabel, setRenamedCategoryLabel] = useState('');
  const unavailable = props.busy || !props.online;

  async function createCategory() {
    await props.onCreateCategory(categoryLabel);
    setCategoryLabel('');
  }

  async function renameCategory(item: StatusItem) {
    await props.onRenameCategory(item, renamedCategoryLabel);
    setRenamingCategoryId(undefined);
    setRenamedCategoryLabel('');
  }

  return (
    <section className="member-workspace" aria-labelledby="aircraft-documents-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Configured records</span>
          <h2 id="aircraft-documents-title">Aircraft documents</h2>
          <p>
            Status reflects FlyEye record configuration only. It is not an airworthiness or dispatch
            decision.
          </p>
        </div>
        <button className="text-button" type="button" onClick={props.onClose}>
          Back to workspace
        </button>
      </div>
      {!props.online ? (
        <p className="notice notice--warning">
          Offline — previously loaded results are stale and read-only.
        </p>
      ) : null}
      {props.message ? (
        <p className="notice notice--warning" role="alert">
          {props.message}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {props.announcement}
      </p>
      <NotificationList items={props.notifications} onOpen={props.onOpenNotification} />
      <LoadMoreButton
        onClick={props.onLoadMoreNotifications}
        disabled={unavailable}
        label="Load more notifications"
      />
      <label className="field">
        Aircraft
        <select
          value={props.selectedId ?? ''}
          onChange={(event) => props.onSelect(event.target.value)}
          disabled={props.busy || props.aircraft.length === 0}
        >
          {props.aircraft.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <LoadMoreButton
        onClick={props.onLoadMoreAircraft}
        disabled={unavailable}
        label="Load more aircraft"
      />
      {props.busy && !props.status ? (
        <div className="loading-line" aria-label="Loading aircraft documents" />
      ) : null}
      {!props.busy && props.aircraft.length === 0 ? (
        <p className="empty-state">No tracked aircraft records are available.</p>
      ) : null}
      {props.status ? (
        <ul className="document-list">
          {props.status.items.map((item) => (
            <li key={item.categoryId}>
              <div>
                <strong>{item.categoryLabel}</strong>
                <span>
                  {item.expirationDate
                    ? `Expires ${item.expirationDate}`
                    : 'No current document version'}
                </span>
              </div>
              <span className={`document-status document-status--${item.status}`}>
                <span aria-hidden="true">●</span> {documentStatusLabel(item.status)}
              </span>
              <CategoryActions
                item={item}
                props={props}
                beginRename={(label) => {
                  setRenamingCategoryId(item.categoryId);
                  setRenamedCategoryLabel(label);
                }}
              />
              {renamingCategoryId === item.categoryId ? (
                <form
                  className="category-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameCategory(item);
                  }}
                >
                  <label className="field">
                    Category name
                    <input
                      value={renamedCategoryLabel}
                      onChange={(event) => setRenamedCategoryLabel(event.target.value)}
                      maxLength={120}
                      disabled={props.busy}
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      type="submit"
                      disabled={props.busy || !props.online || !renamedCategoryLabel.trim()}
                    >
                      Save name
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setRenamingCategoryId(undefined)}
                      disabled={props.busy}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {props.canManageCategories && props.selectedId ? (
        <div className="custom-category-form">
          {props.status?.availableCustomCategories.length ? (
            <>
              <label className="field">
                Existing custom category
                <select
                  value={availableCategoryId}
                  onChange={(event) => setAvailableCategoryId(event.target.value)}
                  disabled={props.busy}
                >
                  <option value="">Choose a category</option>
                  {props.status.availableCustomCategories.map((category) => (
                    <option key={category.categoryId} value={category.categoryId}>
                      {category.categoryLabel}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  const category = props.status?.availableCustomCategories.find(
                    (item) => item.categoryId === availableCategoryId,
                  );
                  if (category) void props.onAssignCategory(category);
                }}
                disabled={props.busy || !props.online || !availableCategoryId}
              >
                Assign to this aircraft
              </button>
            </>
          ) : null}
          <label className="field">
            New custom category
            <input
              value={categoryLabel}
              onChange={(event) => setCategoryLabel(event.target.value)}
              maxLength={120}
              disabled={props.busy}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void createCategory()}
            disabled={props.busy || !props.online || !categoryLabel.trim()}
          >
            Add to this aircraft
          </button>
        </div>
      ) : null}
    </section>
  );
}

function LoadMoreButton({
  onClick,
  disabled,
  label,
}: {
  onClick?: () => void;
  disabled: boolean;
  label: string;
}) {
  return onClick ? (
    <button type="button" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ) : null;
}

function CategoryActions({
  item,
  props,
  beginRename,
}: {
  item: StatusItem;
  props: Props;
  beginRename: (label: string) => void;
}) {
  return (
    <div className="invitation-actions">
      {props.canReadDetails && item.documentId ? (
        <button
          type="button"
          onClick={() => props.onOpenDocument(item.documentId ?? '')}
          disabled={props.busy}
        >
          View
        </button>
      ) : null}
      {props.canManage && !item.documentId ? (
        <button
          type="button"
          onClick={() => props.onCreateDocument(item)}
          disabled={props.busy || !props.online}
        >
          Add document
        </button>
      ) : null}
      {props.canManageCategories && item.categoryKind === 'custom' ? (
        <>
          <button
            type="button"
            onClick={() => beginRename(item.categoryLabel)}
            disabled={props.busy || !props.online}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void props.onRemoveCategory(item)}
            disabled={props.busy || !props.online || !item.requirementVersion}
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() => void props.onArchiveCategory(item)}
            disabled={props.busy || !props.online}
          >
            Archive category
          </button>
        </>
      ) : null}
    </div>
  );
}

function NotificationList({
  items,
  onOpen,
}: {
  items: AircraftDocumentNotification[];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="document-notifications" aria-labelledby="document-notifications-title">
      <h3 id="document-notifications-title">Expiry notifications</h3>
      <ul>
        {items.map((notification) => (
          <li key={notification.id}>
            <button type="button" onClick={() => onOpen(notification.id)}>
              <strong>
                {notification.aircraftRegistration} · {notification.categoryLabel}
              </strong>
              <span>
                {notification.eventKind === 'warning' ? 'Expiring soon' : 'Expired'} ·{' '}
                {notification.expirationDate}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
