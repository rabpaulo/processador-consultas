-- Esquema opcional baseado no enunciado. Não contém dados reais.
CREATE SCHEMA IF NOT EXISTS BD_Vendas;
USE BD_Vendas;

CREATE TABLE IF NOT EXISTS Categoria (
  idCategoria INT NOT NULL,
  Descricao VARCHAR(45) NOT NULL,
  PRIMARY KEY (idCategoria)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Produto (
  idProduto INT NOT NULL,
  Nome VARCHAR(45) NOT NULL,
  Descricao VARCHAR(200) NULL,
  Preco DECIMAL(18,2) NOT NULL DEFAULT 0,
  QuantEstoque DECIMAL(10,2) NOT NULL DEFAULT 0,
  Categoria_idCategoria INT NOT NULL,
  PRIMARY KEY (idProduto),
  CONSTRAINT fk_Produto_Categoria FOREIGN KEY (Categoria_idCategoria)
    REFERENCES Categoria (idCategoria) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS TipoCliente (
  idTipoCliente INT NOT NULL,
  Descricao VARCHAR(45) NULL,
  PRIMARY KEY (idTipoCliente)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Cliente (
  idCliente INT NOT NULL,
  Nome VARCHAR(45) NOT NULL,
  Email VARCHAR(100) NOT NULL,
  Nascimento DATETIME NULL,
  Senha VARCHAR(200) NULL,
  TipoCliente_idTipoCliente INT NOT NULL,
  DataRegistro DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (idCliente),
  CONSTRAINT fk_Cliente_TipoCliente FOREIGN KEY (TipoCliente_idTipoCliente)
    REFERENCES TipoCliente (idTipoCliente) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS TipoEndereco (
  idTipoEndereco INT NOT NULL,
  Descricao VARCHAR(45) NOT NULL,
  PRIMARY KEY (idTipoEndereco)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Endereco (
  idEndereco INT NOT NULL,
  EnderecoPadrao TINYINT NOT NULL DEFAULT 0,
  Logradouro VARCHAR(45) NULL,
  Numero VARCHAR(45) NULL,
  Complemento VARCHAR(45) NULL,
  Bairro VARCHAR(45) NULL,
  Cidade VARCHAR(45) NULL,
  UF VARCHAR(2) NULL,
  CEP VARCHAR(8) NULL,
  TipoEndereco_idTipoEndereco INT NOT NULL,
  Cliente_idCliente INT NOT NULL,
  PRIMARY KEY (idEndereco),
  CONSTRAINT fk_Endereco_TipoEndereco FOREIGN KEY (TipoEndereco_idTipoEndereco)
    REFERENCES TipoEndereco (idTipoEndereco) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_Endereco_Cliente FOREIGN KEY (Cliente_idCliente)
    REFERENCES Cliente (idCliente) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Telefone (
  Numero VARCHAR(42) NOT NULL,
  Cliente_idCliente INT NOT NULL,
  PRIMARY KEY (Numero, Cliente_idCliente),
  CONSTRAINT fk_Telefone_Cliente FOREIGN KEY (Cliente_idCliente)
    REFERENCES Cliente (idCliente) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Status (
  idStatus INT NOT NULL,
  Descricao VARCHAR(45) NOT NULL,
  PRIMARY KEY (idStatus)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Pedido (
  idPedido INT NOT NULL,
  Status_idStatus INT NOT NULL,
  DataPedido DATETIME NOT NULL DEFAULT NOW(),
  ValorTotalPedido DECIMAL(18,2) NOT NULL DEFAULT 0,
  Cliente_idCliente INT NOT NULL,
  PRIMARY KEY (idPedido),
  CONSTRAINT fk_Pedido_Status FOREIGN KEY (Status_idStatus)
    REFERENCES Status (idStatus) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_Pedido_Cliente FOREIGN KEY (Cliente_idCliente)
    REFERENCES Cliente (idCliente) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS Pedido_has_Produto (
  idPedidoProduto INT NOT NULL AUTO_INCREMENT,
  Pedido_idPedido INT NOT NULL,
  Produto_idProduto INT NOT NULL,
  Quantidade DECIMAL(10,2) NOT NULL,
  PrecoUnitario DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (idPedidoProduto),
  CONSTRAINT fk_Pedido_has_Produto_Pedido FOREIGN KEY (Pedido_idPedido)
    REFERENCES Pedido (idPedido) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT fk_Pedido_has_Produto_Produto FOREIGN KEY (Produto_idProduto)
    REFERENCES Produto (idProduto) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;
