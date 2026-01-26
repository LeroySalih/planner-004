-- Unlock all users by removing failed sign-in attempts that contribute to the lockout.
-- The application logic checks for failed attempts within the last 15 minutes (default window).
-- Deleting these records removes the lock condition.

DELETE FROM sign_in_attempts 
WHERE success = false;
