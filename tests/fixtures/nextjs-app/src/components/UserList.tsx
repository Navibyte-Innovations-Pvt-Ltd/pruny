export function UserList() {
  const fetchUsers = () => fetch('/api/users');
  return <div>Users</div>;
}
