/**
 * Стартовый макет этикетки 58×40 мм — как превью на карточке склада:
 * название, код/артикул, штрихкод из item.barcode.
 */
export const ITEM_LABEL_TEMPLATE_HTML = `<div class="item-label-layout" style="display: flex; flex-direction: column; box-sizing: border-box; height: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000;">
<p class="item-label-title" style="margin: 0; padding: 0; font-size: 8pt; font-weight: 600; line-height: 1.15; word-break: break-word;"><span class="doc-field" data-field="item.name">Уплотнитель канала</span></p>
<p class="item-label-meta" style="margin: 0.6mm 0 0; padding: 0; font-size: 6.5pt; font-weight: 400; line-height: 1.15; color: #404040; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><span class="doc-field" data-field="item.labelMeta">Код INV-000001 · Арт. ART-100</span></p>
<div class="item-label-barcode" style="display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 0; margin: 1.5mm 0 0; padding: 0;"><span class="doc-barcode" data-code="{{item.barcode}}" contenteditable="false">Штрихкод</span></div>
</div>`
