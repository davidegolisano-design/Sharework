begin;

alter table public.sw_annotations
 drop constraint sw_annotations_shape_check,
 add constraint sw_annotations_shape_check check (shape in (
  'circle','square','diamond','triangle','flame','warning','electric','tool',
  'welding','pipes','lifting','painting','inspection','ppe','cleaning','fire_watch',
  'mechanical','drilling','measurement','testing'
 ));

commit;
