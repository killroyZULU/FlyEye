import type { AuthGateway } from '../../auth';
import { MemberDetailCard } from './MemberDetailCard';
import { MemberDirectoryView } from './MemberDirectoryView';
import { MemberRoleConfirmation } from './MemberRoleConfirmation';
import { MemberStatusConfirmation } from './MemberStatusConfirmation';
import { useMemberAdministrationCommands } from './useMemberAdministrationCommands';
import { useMemberDirectory } from './useMemberDirectory';

type MemberAdministrationPanelProps = {
  gateway: AuthGateway;
  organizationId: string;
  organizationName: string;
  currentMembershipId: string;
  onClose: () => void;
  onRequirePassword: (message: string) => void;
};

export function MemberAdministrationPanel({
  gateway,
  organizationId,
  organizationName,
  currentMembershipId,
  onClose,
  onRequirePassword,
}: MemberAdministrationPanelProps) {
  const directory = useMemberDirectory({ gateway, organizationId });
  const commands = useMemberAdministrationCommands({
    gateway,
    organizationId,
    onRequirePassword,
    directory,
  });
  const { selected, setSelected, busy, message } = directory;
  const { confirmation, roleConfirmation, membersHeading } = commands;
  return (
    <section className="member-workspace" aria-labelledby="members-heading">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Administration</span>
          <h2 id="members-heading" tabIndex={-1} ref={membersHeading}>
            Organization members
          </h2>
          <p>{organizationName}</p>
        </div>
        <button className="text-button" type="button" onClick={onClose}>
          Back to workspace
        </button>
      </div>

      {roleConfirmation ? (
        <MemberRoleConfirmation
          organizationName={organizationName}
          roleConfirmation={roleConfirmation}
          busy={busy}
          confirmationHeading={commands.confirmationHeading}
          setRoleConfirmation={commands.setRoleConfirmation}
          confirmRoleAction={commands.confirmRoleAction}
        />
      ) : null}
      {confirmation ? (
        <MemberStatusConfirmation
          organizationName={organizationName}
          confirmation={confirmation}
          busy={busy}
          confirmationHeading={commands.confirmationHeading}
          setConfirmation={commands.setConfirmation}
          confirmStatusAction={commands.confirmStatusAction}
        />
      ) : null}
      {!confirmation && !roleConfirmation ? (
        <MemberDirectoryView directory={directory}>
          {selected ? (
            <MemberDetailCard
              selected={selected}
              currentMembershipId={currentMembershipId}
              setSelected={setSelected}
              beginStatusAction={commands.beginStatusAction}
              beginRoleAction={commands.beginRoleAction}
            />
          ) : null}
        </MemberDirectoryView>
      ) : null}
      <p className="status-message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
