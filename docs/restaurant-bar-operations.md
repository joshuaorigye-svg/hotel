# Restaurant and Bar operations

Managers in the Restaurant and Kitchen or Bar departments use Manager > Department operations to capture dine-in, takeaway and room-service orders, progress the live service queue, and record stock receipts, corrections and wastage.

Stock deductions happen only when an order is marked Served. To automate ingredient usage, create menu recipes by inserting rows into menu_item_ingredients, linking a department menu item to its inventory_items row with the quantity required per serving. The database checks all required stock before serving an order and records each deduction in inventory_movements. Orders without recipe links do not deduct stock automatically.

The owner or department manager must first create stock items in inventory_items and menu items in restaurant_menu_items, assigning each to the matching department. Public menu items remain visible only when marked available. Apply migration 0008_restaurant_bar_operations.sql in Supabase before using these features.
