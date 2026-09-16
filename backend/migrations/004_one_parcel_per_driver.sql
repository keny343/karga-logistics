-- One driver carries one parcel at a time.
--
-- The service already refuses a second assignment, but it checks by counting the
-- driver's open orders inside a transaction that locks the *order* row. Two
-- operators assigning the same driver to two different orders lock different rows,
-- both count zero, and both write. The window is small and the consequence is a
-- driver with two parcels and a dispatcher who trusts the screen.
--
-- The rule belongs where a race cannot get past it.
CREATE UNIQUE INDEX orders_motorista_activo_idx
  ON orders (driver_id)
  WHERE driver_id IS NOT NULL
    AND status IN ('ATRIBUIDO', 'RECOLHIDO', 'EM_ENTREGA');
