import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { TalentCatalogueController } from './talent-catalogue.controller';
import { TalentCatalogueService } from './talent-catalogue.service';

/**
 * Public discovery for both marketplaces.
 *
 * Read-only throughout: nothing here mutates state or holds stock, which is what makes it
 * safe to expose without a session.
 */
@Module({
  controllers: [CatalogueController, TalentCatalogueController],
  providers: [CatalogueService, TalentCatalogueService],
  exports: [CatalogueService, TalentCatalogueService],
})
export class CatalogueModule {}
