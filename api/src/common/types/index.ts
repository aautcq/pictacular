// Prevent TypeScript from displaying a deeply nested or complex type in error messages or tooltips, instead showing the "unexpanded" version of the type.
type NoExpand<T> = T extends unknown ? T : never;

// The passed must be entirely optional
export type AtLeast<O extends object, K extends string> = NoExpand<
  O extends unknown
    ?
        | (K extends keyof O ? { [P in K]: O[P] } & O : O)
        | ({ [P in keyof O as P extends K ? K : never]-?: O[P] } & O)
    : never
>;
