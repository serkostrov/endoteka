/**
 * Образец «Акт диагностики» в стиле RoApp / Word:
 * Times New Roman, сплошные рамки, шапка с логотипом, таблицы без «серых точек».
 */
function field(key: string, preview: string) {
  return `<span class="doc-field" data-field="${key}">${preview}</span>`
}

export const DIAGNOSTIC_ACT_TEMPLATE_HTML = `<div style="text-align: center;">
<table style="border-collapse: collapse; width: 100%; border-color: #ffffff;" border="0" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="width: 17%; vertical-align: middle; border: none;">
<img style="display: block; margin-left: auto; margin-right: auto;" src="https://i.postimg.cc/Kv6grL5w/1-kopia.png" alt="" width="150" height="150" />
</td>
<td style="width: 83%; vertical-align: middle; border: none; text-align: center;">
<p style="text-align: center; margin: 0;"><strong><span style="font-size: 28pt; font-family: 'Times New Roman', Times, serif;">ООО «ЭНДОТЕКА»</span></strong></p>
<p style="text-align: center; margin: 4pt 0 8pt;"><span style="font-size: 11pt; font-family: 'Times New Roman', Times, serif;">КОМПЛЕКСНОЕ СЕРВИСНОЕ ОБСЛУЖИВАНИЕ ЭНДОСКОПИЧЕСКОГО ОБОРУДОВАНИЯ</span></p>
<p style="margin: 0 0 10pt; border-bottom: 1px solid #000; line-height: 0;">&nbsp;</p>
<table style="border-collapse: collapse; width: 100%; margin-left: auto; margin-right: auto;" border="0" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="width: 27%; border: none; border-right: 1pt solid #000; padding: 0 8pt; vertical-align: top; text-align: left;">
<p style="margin: 0; text-align: left;"><span style="font-size: 11pt; font-family: 'Times New Roman', Times, serif;">ИНН 5017142563</span></p>
<p style="margin: 0; text-align: left;"><span style="font-size: 11pt; font-family: 'Times New Roman', Times, serif;">КПП 502401001</span></p>
</td>
<td style="width: 46%; border: none; border-right: 1pt solid #000; padding: 0 8pt; vertical-align: top; text-align: center;">
<p style="margin: 0;"><span style="font-size: 11pt; font-family: 'Times New Roman', Times, serif;">125481, Г. МОСКВА, УЛ. ПЛАНЕРНАЯ, Д. 6, КОРП. 2</span></p>
</td>
<td style="width: 27%; border: none; padding: 0 8pt; vertical-align: top; text-align: right;">
<p style="margin: 0; text-align: right;"><span style="font-size: 11pt; font-family: 'Times New Roman', Times, serif;">ТЕЛ: (903) 299-41-66</span></p>
<p style="margin: 0; text-align: right;"><span style="font-size: 11pt; font-family: 'Times New Roman', Times, serif;">ENDOREM@MAIL.RU</span></p>
</td>
</tr>
</tbody>
</table>
</td>
</tr>
</tbody>
</table>
</div>
<p style="text-align: center; margin: 18pt 0 4pt;"><strong><span style="font-size: 14pt; font-family: 'Times New Roman', Times, serif;">АКТ ДИАГНОСТИКИ №${field('order.number', 'ЗК-0001')}</span></strong></p>
<p style="margin: 0 0 12pt; font-family: 'Times New Roman', Times, serif; font-size: 12pt;">
<span>г. Москва</span>
<span style="float: right;">${field('order.createdAt', '25.08.26')}</span>
</p>
<table style="border-collapse: collapse; width: 100%; margin: 0 auto;" border="1" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="width: 32%; vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Клиент</span></strong></td>
<td style="width: 68%; vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('customer.name', 'ООО «Клиника»')}</span></td>
</tr>
<tr>
<td style="width: 32%; vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Наименование оборудования</span></strong></td>
<td style="width: 68%; vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('device.group', 'Гастроскоп')} ${field('device.brand', 'Olympus')} ${field('device.model', 'GIF-H190')}, SN: ${field('device.serialNumber', 'SN-12345')}</span></td>
</tr>
<tr>
<td style="width: 32%; vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Комплектация</span></strong></td>
<td style="width: 68%; vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('order.completeness', 'Прибор, кейс')}</span></td>
</tr>
</tbody>
</table>
<p style="text-align: center; margin: 4pt 0 2pt; padding: 0; line-height: 1;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">ТЕХНИЧЕСКОЕ СОСТОЯНИЕ</span></strong></p>
<table style="border-collapse: collapse; width: 100%; margin: 0 auto;" border="1" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Герметичность</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.germetichnost', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Подача воды/воздуха</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.podacha_vody_vozduha', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Видеоизображение / фиброволокно</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.videoizobrazhenie_fibrovolkno', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Кнопки управления</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.knopki_upravleniya', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Волокно подсветки</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.volokno_podsvetki', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Дистальная головка</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.distalnaya_golovka', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">А - резина</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.a_rezina', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Изгибаемая часть</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.izgibaemaya_chast', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Трубка вводимая</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.trubka_vvodimaya', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Канал инструментальный</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.kanal_instrumentalnyj', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Канал воды/воздуха</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.kanal_podachi_vody_vozduha', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Канал доп. подачи воды</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.kanal_dop_podachi_vody', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Трубка универсальная</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.trubka_universalnaya', 'Норма')}</span></td>
</tr>
<tr>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Коннектор</span></strong></td>
<td style="vertical-align: middle; padding: 2pt 5pt; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.konnektor', 'Норма')}</span></td>
</tr>
</tbody>
</table>
<p style="text-align: center; margin: 4pt 0 2pt; padding: 0; line-height: 1;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">ПРОЧИЕ ДЕФЕКТЫ</span></strong></p>
<table style="border-collapse: collapse; width: 100%; margin: 0 auto;" border="1" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="min-height: 28pt; padding: 3pt 5pt; vertical-align: top; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.prochie_defekty', '—')}</span></td>
</tr>
</tbody>
</table>
<p style="text-align: center; margin: 4pt 0 2pt; padding: 0; line-height: 1;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">ЗАКЛЮЧЕНИЕ</span></strong></p>
<table style="border-collapse: collapse; width: 100%; margin: 0 auto;" border="1" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="min-height: 36pt; padding: 3pt 5pt; vertical-align: top; line-height: 1.15;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('field.diagnostics.zaklyuchenie', '—')}</span></td>
</tr>
</tbody>
</table>
<p style="text-align: center; margin: 4pt 0 0; line-height: 1;"><strong><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">ПОДПИСИ СТОРОН:</span></strong></p>
<table style="border-collapse: collapse; width: 100%; border-color: #ffffff;" border="0" cellspacing="0" cellpadding="0">
<tbody>
<tr>
<td style="width: 50%; text-align: center; vertical-align: top; border: none; padding: 4pt;">
<img src="https://i.postimg.cc/MHqgqkSt/Snimok-ekrana-2026-07-09-101352.png" alt="" width="280" height="153" />
</td>
<td style="width: 50%; text-align: center; vertical-align: top; border: none; padding: 4pt;">
<p style="margin: 0 0 6pt;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">Представитель Заказчика</span></p>
<p style="margin: 0 0 18pt;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">${field('customer.name', 'ООО «Клиника»')}</span></p>
<p style="margin: 0 0 8pt;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">____________________ / ___________________</span></p>
<p style="margin: 0;"><span style="font-size: 12pt; font-family: 'Times New Roman', Times, serif;">М.П.</span></p>
</td>
</tr>
</tbody>
</table>
`
