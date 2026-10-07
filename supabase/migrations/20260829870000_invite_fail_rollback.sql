-- Allow rolling back an invitation after Auth user was created but email failed.
create or replace function public.fail_invitation(target_invitation_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('users:invite') then
    raise exception 'Недостаточно прав.';
  end if;

  update public.invitations
  set status = 'failed',
      accepted_at = null,
      auth_user_id = null
  where id = target_invitation_id
    and invited_by = auth.uid()
    and status in ('pending', 'accepted');

  perform public.record_audit(
    'users.invite_failed',
    'invitation',
    target_invitation_id::text,
    jsonb_build_object('reason', reason)
  );
end;
$$;
