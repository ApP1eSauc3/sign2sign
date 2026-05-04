# Sign2Sign — Navigation Layer

This file loads automatically for any file under `src/navigation/`.

> Navigation is infrastructure, not UI. Stacks define routes and type-safe param lists. They have no business logic, no state, no service calls. Their only job is to declare which screens exist and what params they accept.

---

## Typed param lists — always define, always use

Every stack must export its `ParamList` type. Screens use it for typed `navigation` and `route` props.

```typescript
// ✅ — exported from the stack file
export type AdminStackParamList = {
  AdminLogin: undefined;
  AdminDashboard: undefined;
};

// ✅ — used in the screen
type Props = NativeStackScreenProps<AdminStackParamList, 'AdminLogin'>;
export default function AdminLoginScreen({ navigation }: Props) { ... }

// ❌ — untyped navigation prop
export default function AdminLoginScreen({ navigation }: any) { ... }
```

---

## `replace` vs `navigate` vs `push`

| Method | Use when |
|---|---|
| `navigation.replace('X')` | After login/auth — removes current screen from stack so back button doesn't return to it |
| `navigation.navigate('X')` | Standard navigation — idempotent, won't push if already on X |
| `navigation.push('X')` | Intentionally add a duplicate screen to the stack (rare) |

---

## `AppMode` drives the root navigator — not navigation actions

```typescript
// ✅ — switching worlds (admin ↔ driver) goes through the store
const setMode = useAppStore((s) => s.setMode);
setMode(AppMode.Undecided);

// ❌ — you cannot navigate between stacks; they are separate trees
navigation.navigate('DriverCode');  // unreachable from AdminStack
```

---

## `headerShown: false` is the default

All stacks use `screenOptions={{ headerShown: false }}`. Custom headers are built per-screen in `src/screens/`. Never rely on the native navigation header for layout.

---

## What to avoid

- Business logic or service calls in navigator files
- Raw hex or style values — navigation files have no UI
- Adding screens to the wrong stack — admin and driver never share screens
