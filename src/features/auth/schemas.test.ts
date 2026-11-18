import {describe, expect, it} from 'vitest';
import {forgotSchema, loginSchema, passwordStrength, resetSchema, signupSchema} from './schemas';

// Rules from API_DESIGN.md A1: email (valid email), password (8-128 characters), name (1-80).

/** The first message for each field that failed, or {} when the value is valid. */
function errors(schema: {safeParse: (v: unknown) => unknown}, value: unknown): Record<string, string> {
  const result = schema.safeParse(value) as
    | {success: true}
    | {success: false; error: {issues: {path: (string | number)[]; message: string}[]}};
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

const validSignup = {name: 'Asha', email: 'asha@example.com', password: 'long-enough-1'};

describe('signupSchema', () => {
  it('accepts a valid name, email and password', () => {
    expect(errors(signupSchema, validSignup)).toEqual({});
  });

  it('asks for every field when the form is empty', () => {
    expect(errors(signupSchema, {name: '', email: '', password: ''})).toEqual({
      name: 'Tell us your name.',
      email: 'Enter your email.',
      password: 'Use at least 8 characters.',
    });
  });

  it('rejects a name that is only spaces', () => {
    expect(errors(signupSchema, {...validSignup, name: '   '})).toHaveProperty('name');
  });

  it('accepts a name of 80 characters and rejects 81', () => {
    expect(errors(signupSchema, {...validSignup, name: 'a'.repeat(80)})).toEqual({});
    expect(errors(signupSchema, {...validSignup, name: 'a'.repeat(81)})).toHaveProperty('name');
  });

  it.each(['plain', 'no-at.example.com', 'a@b', 'a b@example.com', '@example.com'])('rejects the email "%s"', (email) => {
    expect(errors(signupSchema, {...validSignup, email})).toEqual({email: 'Enter a valid email address.'});
  });

  it('trims spaces around the name and email', () => {
    const parsed = signupSchema.parse({...validSignup, name: '  Asha  ', email: '  asha@example.com '});
    expect(parsed.name).toBe('Asha');
    expect(parsed.email).toBe('asha@example.com');
  });

  it('accepts passwords of 8 and 128 characters and rejects 7 and 129', () => {
    expect(errors(signupSchema, {...validSignup, password: 'a'.repeat(8)})).toEqual({});
    expect(errors(signupSchema, {...validSignup, password: 'a'.repeat(128)})).toEqual({});
    expect(errors(signupSchema, {...validSignup, password: 'a'.repeat(7)})).toEqual({password: 'Use at least 8 characters.'});
    expect(errors(signupSchema, {...validSignup, password: 'a'.repeat(129)})).toEqual({
      password: 'Use at most 128 characters.',
    });
  });

  it('does not trim the password', () => {
    expect(signupSchema.parse({...validSignup, password: '  spaced  '}).password).toBe('  spaced  ');
  });
});

describe('loginSchema', () => {
  it('asks for the email and the password when empty', () => {
    expect(errors(loginSchema, {email: '', password: ''})).toEqual({
      email: 'Enter your email.',
      password: 'Enter your password.',
    });
  });

  it('accepts any non-empty password, so old short passwords can still log in', () => {
    expect(errors(loginSchema, {email: 'a@b.com', password: 'x'})).toEqual({});
  });

  it('rejects a malformed email', () => {
    expect(errors(loginSchema, {email: 'nope', password: 'x'})).toEqual({email: 'Enter a valid email address.'});
  });
});

describe('forgotSchema', () => {
  it('needs a valid email', () => {
    expect(errors(forgotSchema, {email: ''})).toEqual({email: 'Enter your email.'});
    expect(errors(forgotSchema, {email: 'nope'})).toEqual({email: 'Enter a valid email address.'});
    expect(errors(forgotSchema, {email: 'a@b.com'})).toEqual({});
  });
});

describe('resetSchema', () => {
  it('accepts matching passwords of a valid length', () => {
    expect(errors(resetSchema, {password: 'new-password-1', confirm: 'new-password-1'})).toEqual({});
  });

  it('reports a mismatch on the confirm field', () => {
    expect(errors(resetSchema, {password: 'new-password-1', confirm: 'new-password-2'})).toEqual({
      confirm: "Passwords don't match.",
    });
  });

  it('applies the 8-128 length rule to the new password', () => {
    expect(errors(resetSchema, {password: 'short', confirm: 'short'})).toEqual({password: 'Use at least 8 characters.'});
    const long = 'a'.repeat(129);
    expect(errors(resetSchema, {password: long, confirm: long})).toEqual({password: 'Use at most 128 characters.'});
  });
});

describe('passwordStrength', () => {
  it('is 0 for an empty password', () => {
    expect(passwordStrength('')).toBe(0);
  });

  it('rates a short simple password as weak', () => {
    expect(passwordStrength('abc')).toBe(1);
  });

  it('rates a long mixed password as strong', () => {
    expect(passwordStrength('Correct-Horse-42!')).toBe(4);
  });

  it('never rates a non-empty password below 1', () => {
    expect(passwordStrength('a')).toBe(1);
    expect(passwordStrength('1234567')).toBe(1);
  });

  it('goes up as length, mixed case, and digits with symbols are added', () => {
    const steps = ['abcdefgh', 'abcdefghijkl', 'Abcdefghijkl', 'Abcdefghijk1!'].map(passwordStrength);
    expect(steps).toEqual([1, 2, 3, 4]);
  });
});
