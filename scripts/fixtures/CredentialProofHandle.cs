// Windows PowerShell 5.1 / .NET Framework. Recovery keeps the inspected object
// exclusively open until it sets delete disposition on that same handle.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public sealed class CredentialProofHandle : IDisposable {
    [StructLayout(LayoutKind.Sequential)]
    private struct Info {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out Info info);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file, int type, ref byte value, uint size);
    private readonly FileStream stream;
    private readonly bool release;

    private static void CheckAccess(FileSystemSecurity security, bool higherAncestor = false) {
        var user = WindowsIdentity.GetCurrent().User;
        var raw = new RawSecurityDescriptor(security.GetSecurityDescriptorBinaryForm(), 0).DiscretionaryAcl;
        if (raw == null) throw new IOException("Missing discretionary ACL.");
        foreach (GenericAce ace in raw) {
            if (ace.AceType != AceType.AccessAllowed && ace.AceType != AceType.AccessDenied)
                throw new IOException("Unsupported access rule.");
        }
        var owner = (SecurityIdentifier)security.GetOwner(typeof(SecurityIdentifier));
        if (!user.Equals(owner) && !(higherAncestor && (owner.IsWellKnown(WellKnownSidType.LocalSystemSid) ||
            owner.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)))) throw new IOException("Owner mismatch.");
        var writes = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
            FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
            var sid = (SecurityIdentifier)rule.IdentityReference;
            bool grantsWrite = (rule.FileSystemRights & writes) != 0 || (unchecked((uint)rule.FileSystemRights) & 0x50000000u) != 0;
            if (rule.AccessControlType == AccessControlType.Allow && grantsWrite &&
                !sid.Equals(user) && !sid.IsWellKnown(WellKnownSidType.LocalSystemSid) &&
                !sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid) &&
                !sid.IsWellKnown(WellKnownSidType.CreatorOwnerSid)) throw new IOException("Nonprivate path.");
        }
    }
    // Refuse shared, redirected, or reparse-backed operator paths. Ancestors up to
    // the operator profile must also prevent replacement by an unrelated principal.
    public static void VerifyParent(string file) {
        string profile = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)).TrimEnd('\\');
        string absolute = Path.GetFullPath(file);
        if (absolute.StartsWith(@"\\") || !absolute.StartsWith(profile + @"\", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Outside local profile.");
        var parent = Directory.GetParent(absolute);
        for (var dir = parent; dir != null; dir = dir.Parent) {
            if ((dir.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Redirected path.");
            if (dir.FullName.Length >= profile.Length) CheckAccess(dir.GetAccessControl(), dir.FullName != parent.FullName);
        }
    }
    public CredentialProofHandle(string path, bool releaseLock, int limit) {
        release = releaseLock;
        // GENERIC_READ | READ_CONTROL | optional DELETE; OPEN_EXISTING, OPEN_REPARSE_POINT.
        var h = CreateFile(path, 0x80020000u | (release ? 0x10000u : 0u), 0, IntPtr.Zero, 3, 0x00200000u, IntPtr.Zero);
        if (h.IsInvalid) { h.Dispose(); throw new IOException("Exclusive open unavailable."); }
        try {
            Info info;
            if (!GetFileInformationByHandle(h, out info) || info.Links != 1 ||
                (info.Attributes & 0x410u) != 0 || info.SizeHigh != 0 || info.SizeLow == 0 || info.SizeLow > limit)
                throw new IOException("Ambiguous evidence file.");
            stream = new FileStream(h, FileAccess.Read);
            CheckAccess(stream.GetAccessControl());
        } catch { h.Dispose(); throw; }
    }
    public string ReadBase64() {
        stream.Position = 0;
        using (var buffer = new MemoryStream()) { stream.CopyTo(buffer); return Convert.ToBase64String(buffer.ToArray()); }
    }
    public void ReleaseInspectedLock() {
        byte delete = 1;
        if (!release || !SetFileInformationByHandle(stream.SafeFileHandle, 4, ref delete, 1))
            throw new IOException("Release unavailable.");
    }
    public void Dispose() { stream.Dispose(); }
}
