import {z} from 'zod';

const email = z.string().trim().min(1, 'Enter your email.').email('Enter a valid email address.');
const password = z.string().min(8, 'Use at least 8 characters.').max(128, 'Use at most 128 characters.');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
});

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Tell us your name.').max(80, 'Keep it under 80 characters.'),
  email,
  password,
});

export const forgotSchema = z.object({email});

export const resetSchema = z
  .object({password, confirm: z.string()})
  .refine((v) => v.password === v.confirm, {path: ['confirm'], message: "Passwords don't match."});

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
export type ForgotValues = z.infer<typeof forgotSchema>;
export type ResetValues = z.infer<typeof resetSchema>;

/** 0 (empty) to 4 (strong). A rough guide for the strength bar, not a security check. */
export function passwordStrength(value: string): 0 | 1 | 2 | 3 | 4 {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  return Math.max(1, score) as 1 | 2 | 3 | 4;
}
