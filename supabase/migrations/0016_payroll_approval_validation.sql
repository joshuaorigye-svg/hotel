-- Server-side payroll review gate. Apply after 0015.
create or replace function public.approve_payroll_run(p_payroll_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.payroll_runs%rowtype;
  item_count integer;
  totals record;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  select * into target from public.payroll_runs where id=p_payroll_run_id for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if target.status <> 'draft' then raise exception 'Only a draft payroll run can be approved'; end if;
  select count(*) into item_count from public.payroll_items where payroll_run_id=target.id;
  if item_count=0 then raise exception 'Payroll run has no staff entries'; end if;
  if exists (
    select 1 from public.payroll_items i
    where i.payroll_run_id=target.id and (
      i.base_salary <= 0 or i.allowances < 0 or i.deductions < 0 or i.net_pay < 0
      or i.base_salary+i.allowances < i.deductions
      or abs((i.base_salary+i.allowances-i.deductions)-i.net_pay) > 0.01
      or i.advance_deductions < 0 or i.other_deductions < 0
      or i.advance_deductions+i.other_deductions > i.deductions
      or i.payment_status <> 'pending'
    )
  ) then raise exception 'Payroll review failed: one or more employee entries have inconsistent amounts or payment states'; end if;
  select coalesce(sum(base_salary+allowances),0) as gross,
         coalesce(sum(deductions),0) as deductions, coalesce(sum(net_pay),0) as net
  into totals from public.payroll_items where payroll_run_id=target.id;
  if abs(totals.gross-target.total_gross)>0.01
     or abs(totals.deductions-target.total_deductions)>0.01
     or abs(totals.net-target.total_net)>0.01 then
    raise exception 'Payroll review failed: run totals do not match employee entries. Cancel and recreate the draft.';
  end if;
  update public.payroll_runs set status='approved',approved_by=auth.uid(),approved_at=now() where id=target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'Approved reviewed monthly payroll','payroll_run',target.id,
    jsonb_build_object('staff_count',item_count,'total_gross',totals.gross,'total_deductions',totals.deductions,'total_net',totals.net));
end;
$$;
revoke all on function public.approve_payroll_run(uuid) from public;
grant execute on function public.approve_payroll_run(uuid) to authenticated;