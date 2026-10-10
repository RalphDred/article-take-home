/** Ends a `switch` over a union: adding a member without handling it becomes a compile error. */
export function assertNever(value: never, what = 'value'): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
}
