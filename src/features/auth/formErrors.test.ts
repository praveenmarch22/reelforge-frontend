import {describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/client';
import {applyApiError} from './formErrors';

type Form = {name: string; email: string; password: string};

describe('applyApiError', () => {
  it('puts each field message of a validation_error on its field and returns no form message', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'validation_error', 'Please check the form.', {
      fields: {email: 'Enter a valid email address.', password: 'That password is too common.'},
    });

    const message = applyApiError<Form>(error, setError, ['name', 'email', 'password']);

    expect(message).toBeNull();
    expect(setError).toHaveBeenCalledTimes(2);
    expect(setError).toHaveBeenCalledWith('email', {message: 'Enter a valid email address.'});
    expect(setError).toHaveBeenCalledWith('password', {message: 'That password is too common.'});
  });

  it('returns the API message when the error has no field details', () => {
    const setError = vi.fn();
    const error = new ApiError(409, 'email_taken', 'An account with this email already exists.');

    expect(applyApiError<Form>(error, setError, ['name', 'email', 'password'])).toBe(
      'An account with this email already exists.',
    );
    expect(setError).not.toHaveBeenCalled();
  });

  it('returns the API message when none of the failing fields are on this form', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'validation_error', 'Please check the form.', {fields: {token: 'Required'}});

    expect(applyApiError<Form>(error, setError, ['email'])).toBe('Please check the form.');
    expect(setError).not.toHaveBeenCalled();
  });

  it('places the fields it knows and ignores the rest', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'validation_error', 'Please check the form.', {
      fields: {email: 'Bad email', token: 'Required'},
    });

    expect(applyApiError<Form>(error, setError, ['email'])).toBeNull();
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith('email', {message: 'Bad email'});
  });

  it('passes the network error message through', () => {
    const error = new ApiError(0, 'network_error', "Can't reach ReelForge. Check your connection and try again.");

    expect(applyApiError<Form>(error, vi.fn(), ['email'])).toBe(
      "Can't reach ReelForge. Check your connection and try again.",
    );
  });

  it.each([new Error('boom'), 'boom', null, undefined])('returns a generic message for a non-API error (%s)', (error) => {
    const setError = vi.fn();

    expect(applyApiError<Form>(error, setError, ['email'])).toBe('Something went wrong. Please try again.');
    expect(setError).not.toHaveBeenCalled();
  });
});
