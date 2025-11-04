# Description

I want to prototype a faster way to write the a database.  The basic approach is for the server to return immediately, then continue to process the request.  When the request is complete, use Supabase notification API to notify the client of status of the change (successful, fail)

# process

1. Create a path called /prototypes/fast-ui
2. Add a counter label, button that invrements the counter and a label that notifies the user of the status of the write operation.
3. When the user clicks the button, call a server function
4. The server function should return to the client immediately
5. The server function should then delay 10 secs to simulate a heavy task.
6. The server function should then use the Supabase Real Time API to notify the client that call was successful.
7. The status of the operation will be updated in the client UI. 

# Implementation notes

- Route `/prototypes/fast-ui` renders the async counter panel guarded by `requireTeacherProfile()`.
- Server action `triggerFastUiUpdateAction` queues work, logs telemetry, and broadcasts completion on the `fast_ui_updates` channel.
- The client listens for `fast_ui:completed` and `fast_ui:error` events to reconcile in-flight jobs.
- Increment requests are capped at four; once the counter reaches 4 the server returns an error while the UI stays interactive for further experiments.
- Toast notifications surface both success and failure states so testers see the outcome even while experimenting past the limit.
